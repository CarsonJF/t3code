import { describe, expect, it } from "vite-plus/test";

import { silentLogger } from "./log.ts";
import type { TotView } from "./routing.ts";
import { BRIDGE_MESSAGE_LIMIT } from "./split.ts";
import { createTurnRunner } from "./turns.ts";
import { createFakeClock, createFakeT3 } from "./turns.testkit.ts";
import { createWebhookChannelPort, type WebhookMessageApi } from "./webhook.ts";

const home: TotView = {
  id: "home",
  name: "Home",
  enabled: true,
  threadId: "thread-home",
  link: "https://app.t3.codes/threads/env/thread-home",
  environment: "alpha",
};

const createFakeWebhook = () => {
  const sent: Array<{ readonly id: string; readonly content: string }> = [];
  const edits: Array<{ readonly id: string; readonly content: string }> = [];
  const api: WebhookMessageApi = {
    send: async (content) => {
      const id = `webhook-message-${sent.length + 1}`;
      sent.push({ id, content });
      return { id };
    },
    edit: async (messageId, content) => {
      edits.push({ id: messageId, content });
    },
  };
  return { api, sent, edits };
};

const runnerFor = (frames: Parameters<typeof createFakeT3>[0]["frames"]) => {
  const fake = createFakeT3({ frames, tots: [home] });
  const webhook = createFakeWebhook();
  const clock = createFakeClock();
  const runner = createTurnRunner({
    t3For: () => fake.client,
    channel: createWebhookChannelPort(webhook.api),
    logger: silentLogger,
    now: clock.now,
    sleep: clock.sleep,
    onQuestion: () => undefined,
    onSettled: () => undefined,
  });
  const run = () =>
    runner.run({ userId: "channel:1001", tot: home, text: "Hi Home", fresh: false });
  return { ...webhook, run };
};

describe("createWebhookChannelPort", () => {
  it("posts one webhook message and edits that message as the answer streams", async () => {
    const { sent, edits, run } = runnerFor([
      { status: "running", text: "Hello", appears: true },
      { status: "completed", text: "Hello world!" },
    ]);

    const outcome = await run();

    expect(outcome).toEqual({ kind: "replied", text: "Hello world!" });
    expect(sent.map((message) => message.content)).toEqual(["Home is working…"]);
    expect(edits.map((edit) => edit.content)).toEqual(["Hello", "Hello world!"]);
    expect(edits.every((edit) => edit.id === sent[0]?.id)).toBe(true);
  });

  it("sends the rest of a long answer as further webhook messages", async () => {
    const lines = Array.from({ length: 80 }, (_, index) => `Line ${index} of a long answer.`);
    const { sent, edits, run } = runnerFor([
      { status: "running" },
      { status: "running", text: lines[0] ?? "", appears: true },
      { status: "completed", text: lines.join("\n") },
    ]);

    await run();

    expect(sent.length).toBeGreaterThan(1);
    for (const message of [
      ...sent.map((entry) => entry.content),
      ...edits.map((edit) => edit.content),
    ]) {
      expect(message.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
    }
    const delivered = [edits.at(-1)?.content ?? "", ...sent.slice(1).map((entry) => entry.content)];
    expect(delivered.join("\n")).toBe(lines.join("\n"));
  });
});
