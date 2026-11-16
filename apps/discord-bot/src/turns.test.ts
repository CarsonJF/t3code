import { describe, expect, it } from "vite-plus/test";

import type { PendingQuestion } from "./answers.ts";
import { silentLogger } from "./log.ts";
import type { TotView } from "./routing.ts";
import { BRIDGE_MESSAGE_LIMIT } from "./split.ts";
import { type TurnDependencies, activityLabel, createTurnRunner } from "./turns.ts";
import { createFakeChannel, createFakeClock, createFakeT3 } from "./turns.testkit.ts";

const home: TotView = {
  id: "tot-home",
  name: "Home",
  enabled: true,
  threadId: "thread-home",
  link: "https://app.t3.codes/threads/env/thread-home",
  environment: "alpha",
};

const build = (
  options: Parameters<typeof createFakeT3>[0],
): {
  readonly deps: TurnDependencies;
  readonly fake: ReturnType<typeof createFakeT3>;
  readonly channel: ReturnType<typeof createFakeChannel>;
  readonly questions: Array<PendingQuestion>;
  readonly settled: Array<string>;
} => {
  const fake = createFakeT3(options);
  const channel = createFakeChannel();
  const clock = createFakeClock();
  const questions: Array<PendingQuestion> = [];
  const settled: Array<string> = [];
  return {
    fake,
    channel,
    questions,
    settled,
    deps: {
      t3For: () => fake.client,
      channel: channel.port,
      logger: silentLogger,
      now: clock.now,
      sleep: clock.sleep,
      onQuestion: (pending) => questions.push(pending),
      onSettled: (threadId) => settled.push(threadId),
    },
  };
};

const request = (fresh = false) => ({
  userId: "user-1",
  tot: home,
  text: "Hello there",
  fresh,
});

describe("createTurnRunner", () => {
  it("streams one placeholder through to the settled answer", async () => {
    const { deps, fake, channel } = build({
      frames: [
        { status: "running" },
        { status: "running", text: "Hello", appears: true },
        { status: "running", text: "Hello world" },
        { status: "completed", text: "Hello world!" },
      ],
    });

    const outcome = await createTurnRunner(deps).run(request());

    expect(outcome).toEqual({ kind: "replied", text: "Hello world!" });
    expect(channel.sent).toEqual(["Home is working…"]);
    expect(channel.edits.map((edit) => edit.text)).toEqual([
      "Hello",
      "Hello world",
      "Hello world!",
    ]);
    expect(channel.edits.every((edit) => edit.id === "message-1")).toBe(true);
    const firstPoll = fake
      .callsOf("t3_thread_read")
      .find((call) => call.afterPosition !== undefined);
    expect(firstPoll).toMatchObject({ afterPosition: -1 });
  });

  it("sends the rest of a long answer as further messages", async () => {
    const lines = Array.from({ length: 80 }, (_, index) => `Line ${index} of a long answer.`);
    const { deps, channel } = build({
      frames: [
        { status: "running" },
        { status: "running", text: lines[0] ?? "", appears: true },
        { status: "completed", text: lines.join("\n") },
      ],
    });

    const outcome = await createTurnRunner(deps).run(request());

    expect(outcome.kind).toBe("replied");
    for (const text of [...channel.edits.map((edit) => edit.text), ...channel.sent]) {
      expect(text.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
    }
    const finalEdit = channel.edits.at(-1)?.text ?? "";
    const delivered = [finalEdit, ...channel.sent.slice(1)].join("\n");
    expect(delivered).toBe(lines.join("\n"));
  });

  it("passes a fresh session to the Tot when asked", async () => {
    const { deps, fake } = build({
      frames: [{ status: "running" }, { status: "completed", text: "Fresh.", appears: true }],
    });

    await createTurnRunner(deps).run(request(true));

    expect(fake.callsOf("t3_thread_send")[0]).toMatchObject({
      threadId: "thread-home",
      message: "Hello there",
      mode: "auto",
      freshContext: true,
    });
  });

  it("reports the failure text when a turn fails without an answer", async () => {
    const { deps, channel } = build({
      frames: [{ status: "running" }, { status: "failed" }],
      activity: [
        {
          type: "error",
          itemId: "item-error",
          position: 2,
          status: "failed",
          text: "Usage limit reached",
        },
      ],
    });

    const outcome = await createTurnRunner(deps).run(request());

    expect(outcome).toEqual({ kind: "failed", message: "Usage limit reached" });
    expect(channel.edits.at(-1)?.text).toBe("Usage limit reached");
  });

  it("says the turn was stopped when it was interrupted", async () => {
    const { deps, channel } = build({
      frames: [{ status: "running" }, { status: "interrupted" }],
    });

    await createTurnRunner(deps).run(request());

    expect(channel.edits.at(-1)?.text).toBe("Stopped.");
  });

  it("posts a question and records who owes the answer", async () => {
    const { deps, channel, questions } = build({
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
          options: [{ label: "main" }, { label: "new branch" }],
        },
      ],
    });

    await createTurnRunner(deps).run(request());

    const questionPost = channel.sent.filter((text) => text.includes("Which branch"));
    expect(questionPost).toHaveLength(1);
    expect(questions).toEqual([
      expect.objectContaining({
        threadId: "thread-home",
        requestId: "request-1",
        nextIndex: 0,
      }),
    ]);
  });

  it("says where to approve, once, because the bridge cannot approve", async () => {
    const { deps, channel } = build({
      frames: Array.from({ length: 8 }, (_, index) =>
        index === 7
          ? { status: "completed" as const, text: "Done.", appears: true }
          : { status: "running" as const },
      ),
      activity: [
        {
          type: "approval_request",
          itemId: "item-approval",
          position: 2,
          status: "pending",
          text: "Run `rm -rf build`?",
        },
      ],
    });

    await createTurnRunner(deps).run(request());

    const approvals = channel.sent.filter((text) => text.includes("needs your approval"));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toContain("Run `rm -rf build`?");
    expect(approvals[0]).toContain("https://app.t3.codes/threads/env/thread-home");
  });

  it("refuses a second turn for the same Tot while one is running", async () => {
    const { deps } = build({
      frames: Array.from({ length: 4 }, () => ({ status: "running" as const })),
    });
    const runner = createTurnRunner(deps);

    const first = runner.run(request());
    const second = await runner.run(request());

    expect(second).toEqual({ kind: "busy" });
    await first;
  });

  it("tells the caller when the Tot has no thread", async () => {
    const { deps } = build({ frames: [{ status: "running" }] });
    const outcome = await createTurnRunner(deps).run({
      ...request(),
      tot: { ...home, threadId: null },
    });

    expect(outcome).toEqual({ kind: "unavailable", message: "Home has no thread yet." });
  });

  it("clears questions when the turn ends", async () => {
    const { deps, settled } = build({
      frames: [{ status: "running" }, { status: "completed", text: "Done.", appears: true }],
    });

    await createTurnRunner(deps).run(request());

    expect(settled).toEqual(["thread-home"]);
  });
});

describe("activityLabel", () => {
  it("shows the command a Tot is running", () => {
    expect(
      activityLabel([
        {
          type: "command_execution",
          status: "running",
          title: null,
          text: "$ pnpm test\nrunning…",
        },
      ]),
    ).toBe("Running pnpm test");
  });

  it("shows the file being edited", () => {
    expect(
      activityLabel([{ type: "file_change", status: "running", title: null, text: "src/app.ts" }]),
    ).toBe("Editing src/app.ts");
  });

  it("prefers the newest activity item", () => {
    expect(
      activityLabel([
        { type: "command_execution", status: "completed", title: null, text: "$ ls" },
        { type: "web_search", status: "running", title: null, text: null },
      ]),
    ).toBe("Searching the web");
  });

  it("says nothing for reasoning and messages", () => {
    expect(
      activityLabel([{ type: "reasoning", status: "running", title: null, text: "Hmm" }]),
    ).toBeNull();
  });
});
