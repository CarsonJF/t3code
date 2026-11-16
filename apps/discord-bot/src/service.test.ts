import { describe, expect, it } from "vite-plus/test";

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

const build = (options: Parameters<typeof createFakeT3>[0]) => {
  const fake = createFakeT3({ tots, ...options });
  const channel = createFakeChannel();
  const clock = createFakeClock();
  const service = createBridgeService({
    t3: fake.client,
    channelFor: () => channel.port,
    logger: silentLogger,
    now: clock.now,
    sleep: clock.sleep,
    defaultTotName: "Home",
  });
  return { fake, channel, service };
};

const settle = (text: string): Parameters<typeof createFakeT3>[0] => ({
  frames: [{ status: "running" }, { status: "completed", text, appears: true }],
});

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

    expect(reply.text).toContain("This DM now talks to Squirt");
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
  it("offers Tot ids as values", async () => {
    const { service } = build(settle("ok"));

    await expect(service.autocomplete("squ")).resolves.toEqual([
      { name: "Squirt", value: "tot-squirt" },
    ]);
  });
});

describe("formatTotList", () => {
  it("says when nothing is set up", () => {
    expect(formatTotList([], undefined)).toContain("No Tots are set up");
  });

  it("marks a Tot that is off", () => {
    const off = { ...tots[0]!, threadId: null, enabled: false };

    expect(formatTotList([off], undefined)).toContain("Home (off)");
  });
});
