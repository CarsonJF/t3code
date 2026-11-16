import { describe, expect, it } from "vite-plus/test";

import { type EnvironmentCatalog, createEnvironmentCatalog } from "./environments.ts";
import { silentLogger } from "./log.ts";
import { createBridgeService, formatTotList } from "./service.ts";
import { createFakeChannel, createFakeClock, createFakeT3 } from "./turns.testkit.ts";

const tots = [
  {
    id: "tot-home",
    name: "Home",
    enabled: true,
    threadId: "thread-home",
    link: "https://app.t3.codes/threads/env/thread-home",
  },
  {
    id: "tot-squirt",
    name: "Squirt",
    enabled: true,
    threadId: "thread-squirt",
    link: "https://app.t3.codes/threads/env/thread-squirt",
  },
];

interface FakeEnvironment {
  readonly label: string;
  readonly fake: ReturnType<typeof createFakeT3>;
  readonly down?: string;
}

const catalogOf = (entries: ReadonlyArray<FakeEnvironment>): EnvironmentCatalog => {
  const byLabel = new Map(entries.map((entry) => [entry.label, entry]));
  return createEnvironmentCatalog({
    environments: entries.map((entry) => ({
      label: entry.label,
      mcpUrl: `http://${entry.label}.test/mcp`,
      token: `${entry.label}-token-value`,
      avatarCacheDir: `/faces/${entry.label}`,
    })),
    logger: silentLogger,
    createClient: (environment) => {
      const entry = byLabel.get(environment.label);
      if (entry === undefined) throw new Error(`No fake for ${environment.label}.`);
      if (entry.down !== undefined) {
        return {
          call: async () => {
            throw new Error(entry.down);
          },
          close: async () => undefined,
        };
      }
      return entry.fake.client;
    },
  });
};

const build = (options: Parameters<typeof createFakeT3>[0]) => {
  const fake = createFakeT3({ tots, ...options });
  const channel = createFakeChannel();
  const clock = createFakeClock();
  const service = createBridgeService({
    catalog: catalogOf([{ label: "alpha", fake }]),
    channelFor: () => channel.port,
    logger: silentLogger,
    now: clock.now,
    sleep: clock.sleep,
    defaultTotName: "Home",
    multiEnvironment: false,
  });
  return { fake, channel, service };
};

const buildMany = (entries: ReadonlyArray<FakeEnvironment>) => {
  const channel = createFakeChannel();
  const clock = createFakeClock();
  const service = createBridgeService({
    catalog: catalogOf(entries),
    channelFor: () => channel.port,
    logger: silentLogger,
    now: clock.now,
    sleep: clock.sleep,
    defaultTotName: "Home",
    multiEnvironment: true,
  });
  return { channel, service };
};

const settle = (text: string): Parameters<typeof createFakeT3>[0] => ({
  frames: [{ status: "running" }, { status: "completed", text, appears: true }],
});

const channelRef = (totId: string, environment = "alpha") => ({ environment, totId });

describe("handleText", () => {
  it("sends to Home by default", async () => {
    const { fake, service } = build(settle("Hello!"));

    await service.handleText("user-1", "Hi Home");

    expect(fake.callsOf("t3_thread_send")[0]).toMatchObject({
      threadId: "thread-home",
      message: "Hi Home",
    });
  });

  it("keeps talking to the Tot the user picked", async () => {
    const { fake, channel, service } = build(settle("Hello!"));

    const reply = await service.handleCommand("user-1", { kind: "use", name: "squirt" });
    await service.handleText("user-1", "Hi Squirt");

    expect(reply.text).toContain("This DM now talks to Squirt.");
    expect(fake.callsOf("t3_thread_send")[0]).toMatchObject({ threadId: "thread-squirt" });
    expect(channel.edits.at(-1)?.text).toBe("Hello!");
  });

  it("says when the Tot is still working", async () => {
    const { channel, service } = build({
      frames: Array.from({ length: 4 }, () => ({ status: "running" as const })),
    });

    const first = service.handleText("user-1", "One");
    await channel.waitForSend((text) => text.includes("Home is working"));
    await service.handleText("user-1", "Two");

    expect(channel.sent).toContain("Home is still working. Wait for it, or send /tot stop.");
    await first;
  });

  it("answers a pending question from the next DM", async () => {
    const { fake, channel, service } = build({
      frames: [
        { status: "running", pending: 1 },
        { status: "running", pending: 1 },
        { status: "completed", text: "Built it." },
      ],
      pendingRequestIds: ["request-1"],
      questions: [
        {
          id: "q1",
          header: "Branch",
          question: "Which branch should I use?",
          options: [{ label: "main" }, { label: "a new branch", value: "feat/x" }],
        },
      ],
    });

    const running = service.handleText("user-1", "Ship it");
    await channel.waitForSend((text) => text.includes("Which branch"));

    await service.handleText("user-1", "2");

    expect(
      fake.callsOf("t3_pending_request").find((call) => call.action === "respond"),
    ).toMatchObject({
      action: "respond",
      threadId: "thread-home",
      requestId: "request-1",
      answers: { q1: "feat/x" },
    });
    expect(channel.sent).toContain("Answered Branch: feat/x.");
    await running;
  });

  it("repeats the question when the reply is not an answer", async () => {
    const { channel, service } = build({
      frames: [
        { status: "running", pending: 1 },
        { status: "running", pending: 1 },
        { status: "completed", text: "Built it." },
      ],
      pendingRequestIds: ["request-1"],
      questions: [
        {
          id: "q1",
          question: "Which branch?",
          options: [{ label: "main" }],
          allowCustomAnswer: false,
        },
      ],
    });

    const running = service.handleText("user-1", "Ship it");
    await channel.waitForSend((text) => text.includes("Which branch"));
    await service.handleText("user-1", "maybe later");

    expect(channel.sent.at(-1)).toContain("That question takes one of its options.");
    await running;
  });
});

describe("handleCommand", () => {
  it("lists the Tots and marks the one this DM reaches", async () => {
    const { service } = build(settle("ok"));

    const reply = await service.handleCommand("user-1", { kind: "list" });

    expect(reply.text).toContain("Home ← this DM");
    expect(reply.text).toContain("Squirt");
    expect(reply.text).toMatch(/^Tots on this machine:/u);
  });

  it("stops the Tot with the app's Stop", async () => {
    const { fake, service } = build(settle("ok"));

    const reply = await service.handleCommand("user-1", { kind: "stop" });

    expect(reply.text).toBe("Stopped Home.");
    expect(fake.callsOf("t3_thread_interrupt")[0]).toEqual({
      threadId: "thread-home",
      stop: true,
    });
  });

  it("says when nothing was running", async () => {
    const { service } = build({ ...settle("ok"), interruptStatus: "no_active_run" });

    const reply = await service.handleCommand("user-1", { kind: "stop" });

    expect(reply.text).toBe("Home has nothing running.");
  });

  it("arms one fresh session for the next message", async () => {
    const { fake, service } = build(settle("Fresh start."));

    const reply = await service.handleCommand("user-1", { kind: "new" });
    await service.handleText("user-1", "Start over");
    await service.handleText("user-1", "And now normally");

    expect(reply.text).toContain("starts a fresh session");
    const sends = fake.callsOf("t3_thread_send");
    expect(sends[0]).toMatchObject({ freshContext: true });
    expect(sends[1]?.freshContext).toBeUndefined();
  });

  it("refuses a Tot name that matches several Tots", async () => {
    const { service } = build({
      ...settle("ok"),
      tots: [...tots, { ...tots[1]!, id: "tot-squirtle", name: "Squirtle" }],
    });

    const reply = await service.handleCommand("user-1", { kind: "use", name: "squi" });

    expect(reply.text).toContain("No Tot matches squi");
  });
});

describe("autocomplete", () => {
  it("offers Tot ids as values in the single form", async () => {
    const { service } = build(settle("ok"));

    await expect(service.autocomplete("squ")).resolves.toEqual([
      { name: "Squirt", value: "tot-squirt" },
    ]);
  });
});

describe("handleChannelText", () => {
  it("sends to the channel's Tot instead of the sticky one", async () => {
    const { fake, channel, service } = build(settle("Hello channel!"));
    await service.handleCommand("user-1", { kind: "use", name: "squirt" });

    await service.handleChannelText("1001", channelRef("tot-home"), "Hi channel");

    expect(fake.callsOf("t3_thread_send")[0]).toMatchObject({
      threadId: "thread-home",
      message: "Hi channel",
    });
    expect(channel.edits.at(-1)?.text).toBe("Hello channel!");
  });

  it("answers a question asked in the channel", async () => {
    const { fake, channel, service } = build({
      frames: [
        { status: "running", pending: 1 },
        { status: "running", pending: 1 },
        { status: "completed", text: "Built it." },
      ],
      pendingRequestIds: ["request-1"],
      questions: [
        {
          id: "q1",
          header: "Branch",
          question: "Which branch should I use?",
          options: [{ label: "main" }, { label: "a new branch", value: "feat/x" }],
        },
      ],
    });

    const running = service.handleChannelText("1001", channelRef("tot-home"), "Ship it");
    await channel.waitForSend((text) => text.includes("Which branch"));

    await service.handleChannelText("1001", channelRef("tot-home"), "2");

    expect(
      fake.callsOf("t3_pending_request").find((call) => call.action === "respond"),
    ).toMatchObject({ answers: { q1: "feat/x" } });
    expect(channel.sent).toContain("Answered Branch: feat/x.");
    await running;
  });

  it("says when the channel's Tot is off", async () => {
    const { fake, channel, service } = build({
      ...settle("ok"),
      tots: [{ ...tots[0]!, threadId: null, enabled: false }, tots[1]!],
    });

    await service.handleChannelText("1001", channelRef("tot-home"), "Hi");

    expect(channel.sent.at(-1)).toContain("Home is not running.");
    expect(fake.callsOf("t3_thread_send")).toHaveLength(0);
  });

  it("says when the channel names a Tot that is gone", async () => {
    const { fake, channel, service } = build(settle("ok"));

    await service.handleChannelText("1001", channelRef("tot-gone"), "Hi");

    expect(channel.sent.at(-1)).toBe("There is no Tot tot-gone on this T3 server.");
    expect(fake.callsOf("t3_thread_send")).toHaveLength(0);
  });
});

describe("handleChannelStop", () => {
  it("stops that channel's Tot", async () => {
    const { fake, service } = build(settle("ok"));

    const reply = await service.handleChannelStop("1001", channelRef("tot-squirt"));

    expect(reply.text).toBe("Stopped Squirt.");
    expect(fake.callsOf("t3_thread_interrupt")[0]).toEqual({
      threadId: "thread-squirt",
      stop: true,
    });
  });

  it("answers for a Tot that is not there", async () => {
    const { fake, service } = build(settle("ok"));

    const reply = await service.handleChannelStop("1001", channelRef("tot-gone"));

    expect(reply.text).toBe("There is no Tot tot-gone on this T3 server.");
    expect(fake.callsOf("t3_thread_interrupt")).toHaveLength(0);
  });
});

describe("several machines", () => {
  const alphaFake = () =>
    createFakeT3({
      tots: [
        {
          id: "tot-home",
          name: "Home",
          enabled: true,
          threadId: "thread-alpha-home",
          link: "https://alpha.test/thread-alpha-home",
        },
      ],
      frames: [{ status: "running" }, { status: "completed", text: "From alpha.", appears: true }],
    });

  const betaFake = (text = "From beta.") =>
    createFakeT3({
      tots: [
        {
          id: "tot-home",
          name: "Home",
          enabled: true,
          threadId: "thread-beta-home",
          link: "https://beta.test/thread-beta-home",
        },
      ],
      frames: [{ status: "running" }, { status: "completed", text, appears: true }],
    });

  it("groups the Tot list by machine and marks the machine in autocomplete", async () => {
    const { service } = buildMany([
      { label: "alpha", fake: alphaFake() },
      { label: "beta", fake: betaFake() },
    ]);

    const reply = await service.handleCommand("user-1", { kind: "list" });
    const choices = await service.autocomplete("home");

    expect(reply.text).toMatch(/^Tots on these machines:/u);
    expect(reply.text).toContain("alpha\n• Home ← this DM");
    expect(reply.text).toContain("beta\n• Home");
    expect(choices).toEqual([
      { name: "Home (alpha)", value: "alpha:tot-home" },
      { name: "Home (beta)", value: "beta:tot-home" },
    ]);
  });

  it("picks the first machine on a shared name and says where the other is", async () => {
    const alpha = alphaFake();
    const beta = betaFake();
    const { service } = buildMany([
      { label: "alpha", fake: alpha },
      { label: "beta", fake: beta },
    ]);

    const reply = await service.handleCommand("user-1", { kind: "use", name: "Home" });
    await service.handleText("user-1", "Hi");

    expect(reply.text).toContain("This DM now talks to Home on alpha.");
    expect(reply.text).toContain("also on beta");
    expect(reply.text).toContain("/tot use beta:Home");
    expect(alpha.callsOf("t3_thread_send")[0]).toMatchObject({ threadId: "thread-alpha-home" });
    expect(beta.callsOf("t3_thread_send")).toHaveLength(0);
  });

  it("talks to the named machine when the pick says which one", async () => {
    const alpha = alphaFake();
    const beta = betaFake();
    const { channel, service } = buildMany([
      { label: "alpha", fake: alpha },
      { label: "beta", fake: beta },
    ]);

    await service.handleCommand("user-1", { kind: "use", name: "beta:Home" });
    await service.handleText("user-1", "Hi beta");

    expect(beta.callsOf("t3_thread_send")[0]).toMatchObject({ threadId: "thread-beta-home" });
    expect(alpha.callsOf("t3_thread_send")).toHaveLength(0);
    expect(channel.edits.at(-1)?.text).toBe("From beta.");
  });

  it("routes each channel to its own machine", async () => {
    const alpha = alphaFake();
    const beta = betaFake("From beta channel.");
    const { channel, service } = buildMany([
      { label: "alpha", fake: alpha },
      { label: "beta", fake: beta },
    ]);

    await service.handleChannelText("1001", { environment: "alpha", totId: "tot-home" }, "Hi A");
    await service.handleChannelText("2002", { environment: "beta", totId: "tot-home" }, "Hi B");

    expect(alpha.callsOf("t3_thread_send")[0]).toMatchObject({ threadId: "thread-alpha-home" });
    expect(beta.callsOf("t3_thread_send")[0]).toMatchObject({ threadId: "thread-beta-home" });
    expect(channel.edits.map((edit) => edit.text)).toContain("From beta channel.");
  });

  it("keeps serving one machine while the other cannot be loaded", async () => {
    const beta = betaFake("Beta still works.");
    const { channel, service } = buildMany([
      { label: "alpha", fake: alphaFake(), down: "Connection refused" },
      { label: "beta", fake: beta },
    ]);

    const list = await service.handleCommand("user-1", { kind: "list" });
    await service.handleText("user-1", "Hello beta");

    expect(list.text).toContain("Could not load:");
    expect(list.text).toContain("alpha: Connection refused");
    expect(list.text).toContain("• Home ← this DM");
    expect(beta.callsOf("t3_thread_send")[0]).toMatchObject({ threadId: "thread-beta-home" });
    expect(channel.edits.map((edit) => edit.text)).toContain("Beta still works.");
  });

  it("says a channel's machine is unreachable rather than that the Tot is gone", async () => {
    const { channel, service } = buildMany([
      { label: "alpha", fake: alphaFake(), down: "Connection refused" },
      { label: "beta", fake: betaFake() },
    ]);

    await service.handleChannelText("1001", { environment: "alpha", totId: "tot-home" }, "Hi");

    expect(channel.sent.at(-1)).toBe("Could not reach alpha: Connection refused");
    const reply = await service.handleChannelStop("1001", {
      environment: "alpha",
      totId: "tot-home",
    });
    expect(reply.text).toBe("Could not reach alpha: Connection refused");
  });

  it("keeps the single form's DM replies free of machine names", async () => {
    const { service } = build(settle("Hello!"));

    const reply = await service.handleCommand("user-1", { kind: "use", name: "Home" });
    await service.handleText("user-1", "Hi");

    expect(reply.text).toBe("This DM now talks to Home.");
  });
});

describe("formatTotList", () => {
  const withEnvironment = tots.map((tot) => ({ ...tot, environment: "alpha" }));

  it("says when nothing is set up", () => {
    expect(formatTotList([], undefined)).toContain("No Tots are set up");
  });

  it("marks a Tot that is off", () => {
    const off = { ...withEnvironment[0]!, threadId: null, enabled: false };

    expect(formatTotList([off], undefined)).toContain("Home (off)");
  });

  it("lists the machines that could not be read", () => {
    expect(
      formatTotList(withEnvironment, undefined, {
        multiEnvironment: true,
        failures: [{ environment: "beta", reason: "Timed out" }],
      }),
    ).toContain("beta: Timed out");
  });
});
