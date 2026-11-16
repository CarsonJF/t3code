import { describe, expect, it } from "vite-plus/test";

import type { T3Client } from "./t3Client.ts";
import { listTots } from "./tots.ts";

const clientOf = (tots: ReadonlyArray<unknown>): T3Client => ({
  call: async <A>(): Promise<A> => ({ tots }) as A,
  close: async () => undefined,
});

const tot = (input: {
  readonly id: string;
  readonly name: string;
  readonly avatar?: unknown;
  readonly threadId?: string | null;
}) => ({
  id: input.id,
  name: input.name,
  enabled: input.threadId !== null,
  threadId: input.threadId === undefined ? `thread-${input.id}` : input.threadId,
  link: input.threadId === null ? null : `https://app.t3.codes/threads/env/thread-${input.id}`,
  ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
});

describe("listTots", () => {
  it("reads each Tot's face and state from the list", async () => {
    const client = clientOf([
      tot({ id: "home", name: "Home", avatar: { color: "#0a7ea4", shape: "squircle" } }),
      tot({ id: "squirt", name: "Squirt", avatar: { color: "#e879f9", antenna: true } }),
    ]);

    await expect(listTots(client)).resolves.toEqual([
      {
        id: "home",
        name: "Home",
        enabled: true,
        threadId: "thread-home",
        link: "https://app.t3.codes/threads/env/thread-home",
        avatar: { color: "#0a7ea4", shape: "squircle" },
      },
      {
        id: "squirt",
        name: "Squirt",
        enabled: true,
        threadId: "thread-squirt",
        link: "https://app.t3.codes/threads/env/thread-squirt",
        avatar: { color: "#e879f9", antenna: true },
      },
    ]);
  });

  it("wears Home's colour on a server older than the avatar field", async () => {
    const client = clientOf([tot({ id: "home", name: "Home" })]);

    await expect(listTots(client)).resolves.toEqual([
      expect.objectContaining({ id: "home", avatar: { color: "#0a7ea4" } }),
    ]);
  });
});
