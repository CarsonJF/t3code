import { describe, expect, it } from "vite-plus/test";

import { type BridgeEnvironment, createEnvironmentCatalog } from "./environments.ts";
import { createLogger } from "./log.ts";
import type { T3Client } from "./t3Client.ts";

interface FakeClientOptions {
  readonly tots: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly threadId: string | null;
  }>;
  readonly fail?: string;
}

const fakeClient = (options: FakeClientOptions) => {
  const calls: Array<string> = [];
  const client: T3Client = {
    call: async <A>(tool: string): Promise<A> => {
      calls.push(tool);
      if (options.fail !== undefined) throw new Error(options.fail);
      return {
        tots: options.tots.map((tot) => ({
          id: tot.id,
          name: tot.name,
          enabled: tot.threadId !== null,
          threadId: tot.threadId,
          link: tot.threadId === null ? null : `https://app.test/${tot.threadId}`,
          avatar: { color: "#123456" },
        })),
      } as A;
    },
    close: async () => {
      calls.push("close");
    },
  };
  return { client, calls };
};

const environment = (label: string): BridgeEnvironment => ({
  label,
  mcpUrl: `http://${label}.test/mcp`,
  token: `${label}-token-value`,
  avatarCacheDir: `/faces/${label}`,
});

const linesOf = (lines: ReadonlyArray<string>): ReadonlyArray<Record<string, unknown>> =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("createEnvironmentCatalog", () => {
  it("opens a client lazily, once per machine", async () => {
    const alpha = fakeClient({ tots: [{ id: "home", name: "Home", threadId: "thread-a" }] });
    const created: Array<string> = [];
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha"), environment("beta")],
      logger: createLogger({ write: () => undefined, now: () => 0 }),
      createClient: (entry) => {
        created.push(entry.label);
        return entry.label === "alpha" ? alpha.client : fakeClient({ tots: [] }).client;
      },
    });

    expect(created).toEqual([]);
    await catalog.refresh();
    await catalog.refresh();

    expect(created).toEqual(["alpha", "beta"]);
    expect(alpha.calls).toEqual(["t3_tot_list", "t3_tot_list"]);
  });

  it("merges the Tots across machines, in configured order, with their labels", async () => {
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha"), environment("beta")],
      logger: createLogger({ write: () => undefined, now: () => 0 }),
      createClient: (entry) =>
        entry.label === "alpha"
          ? fakeClient({
              tots: [
                { id: "home", name: "Home", threadId: "thread-a" },
                { id: "squirt", name: "Squirt", threadId: null },
              ],
            }).client
          : fakeClient({ tots: [{ id: "home", name: "Home", threadId: "thread-b" }] }).client,
    });

    const snapshot = await catalog.refresh();

    expect(snapshot.failures).toEqual([]);
    expect(snapshot.tots.map((tot) => [tot.environment, tot.id, tot.threadId])).toEqual([
      ["alpha", "home", "thread-a"],
      ["alpha", "squirt", null],
      ["beta", "home", "thread-b"],
    ]);
    expect(snapshot.tots[0]?.avatar).toEqual({ color: "#123456" });
  });

  it("serves the machines that answer while one fails, and reports the failure", async () => {
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha"), environment("beta")],
      logger: createLogger({ write: () => undefined, now: () => 0 }),
      createClient: (entry) =>
        entry.label === "alpha"
          ? fakeClient({ tots: [], fail: "Connection refused" }).client
          : fakeClient({ tots: [{ id: "home", name: "Home", threadId: "thread-b" }] }).client,
    });

    const snapshot = await catalog.refresh();

    expect(snapshot.failures).toEqual([{ environment: "alpha", reason: "Connection refused" }]);
    expect(snapshot.tots.map((tot) => `${tot.environment}:${tot.id}`)).toEqual(["beta:home"]);
  });

  it("re-creates a failed machine's client on the next refresh", async () => {
    let attempt = 0;
    const clients: Array<ReturnType<typeof fakeClient>> = [];
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha")],
      logger: createLogger({ write: () => undefined, now: () => 0 }),
      createClient: () => {
        attempt += 1;
        const created =
          attempt === 1
            ? fakeClient({ tots: [], fail: "Session expired" })
            : fakeClient({ tots: [{ id: "home", name: "Home", threadId: "thread-a" }] });
        clients.push(created);
        return created.client;
      },
    });

    const failed = await catalog.refresh();
    const recovered = await catalog.refresh();

    expect(failed.failures).toHaveLength(1);
    expect(clients[0]?.calls).toEqual(["t3_tot_list", "close"]);
    expect(recovered.failures).toEqual([]);
    expect(recovered.tots.map((tot) => tot.id)).toEqual(["home"]);
    expect(attempt).toBe(2);
  });

  it("logs readiness and failure per machine with counts", async () => {
    const lines: Array<string> = [];
    const logger = createLogger({ write: (line) => lines.push(line), now: () => 0 });
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha"), environment("beta")],
      logger,
      createClient: (entry) =>
        entry.label === "alpha"
          ? fakeClient({
              tots: [
                { id: "home", name: "Home", threadId: "thread-a" },
                { id: "squirt", name: "Squirt", threadId: null },
              ],
            }).client
          : fakeClient({ tots: [], fail: "Timed out" }).client,
    });

    await catalog.refresh();

    const events = linesOf(lines);
    expect(events.find((event) => event.event === "environment.ready")).toMatchObject({
      environment: "alpha",
      tots: 2,
      online: 1,
      recoveredAfter: 0,
    });
    expect(events.find((event) => event.event === "environment.failed")).toMatchObject({
      environment: "beta",
      failures: 1,
      reason: "Timed out",
    });
  });

  it("numbers consecutive failures and notes the recovery", async () => {
    const lines: Array<string> = [];
    let down = true;
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha")],
      logger: createLogger({ write: (line) => lines.push(line), now: () => 0 }),
      createClient: () =>
        fakeClient({
          tots: [{ id: "home", name: "Home", threadId: "thread-a" }],
          ...(down ? { fail: "Connection refused" } : {}),
        }).client,
    });

    await catalog.refresh();
    await catalog.refresh();
    down = false;
    await catalog.refresh();

    const events = linesOf(lines);
    expect(
      events.filter((event) => event.event === "environment.failed").map((event) => event.failures),
    ).toEqual([1, 2]);
    expect(events.at(-1)).toMatchObject({
      event: "environment.ready",
      recoveredAfter: 2,
    });
  });

  it("tells callers the client for a machine, and refuses an unknown one", () => {
    const alpha = fakeClient({ tots: [] });
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha")],
      logger: createLogger({ write: () => undefined, now: () => 0 }),
      createClient: () => alpha.client,
    });

    expect(catalog.clientFor("alpha")).toBe(alpha.client);
    expect(() => catalog.clientFor("gamma")).toThrow("There is no machine labelled gamma.");
  });

  it("closes every client it opened", async () => {
    const made: Array<ReturnType<typeof fakeClient>> = [];
    const catalog = createEnvironmentCatalog({
      environments: [environment("alpha"), environment("beta")],
      logger: createLogger({ write: () => undefined, now: () => 0 }),
      createClient: () => {
        const created = fakeClient({ tots: [] });
        made.push(created);
        return created.client;
      },
    });

    await catalog.refresh();
    await catalog.close();

    expect(made.map((entry) => entry.calls)).toEqual([
      ["t3_tot_list", "close"],
      ["t3_tot_list", "close"],
    ]);
  });
});
