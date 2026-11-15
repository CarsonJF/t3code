import { ThreadId, TotId, totThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { totConversationAttributes } from "./totThreadScope";

it("gives a Tot thread's conversation its Tot id", () => {
  const threadId = totThreadId(TotId.make("yui"), "open");
  expect(totConversationAttributes(threadId)).toEqual({
    "data-thread-id": threadId,
    "data-tot-id": "yui",
  });
});

it("leaves every other thread without a Tot scope but with its thread id", () => {
  for (const threadId of [
    ThreadId.make("thread-plain"),
    // A thread a Tot launched, and a room, are not that Tot's conversation.
    ThreadId.make("tot-launched:bob:one"),
    ThreadId.make("tot-room:design"),
  ]) {
    expect(totConversationAttributes(threadId)).toEqual({ "data-thread-id": threadId });
  }
});
