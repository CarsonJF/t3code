import { TotId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { decideRoomTurn, mentionedMembers, trailingTotMessages } from "./groupChatTurns.ts";

const brain = { id: TotId.make("brain"), name: "Brain" };
const ledger = { id: TotId.make("ledger"), name: "Ledger" };
const deals = { id: TotId.make("deals"), name: "Home Deals" };
const members = [brain, ledger, deals];

const base = { members, moderatorId: brain.id, hopLimit: 4 };

describe("mentionedMembers", () => {
  it("matches names and ids, ignoring case, and keeps member order", () => {
    expect(mentionedMembers("hey @ledger and @BRAIN", members)).toEqual(["brain", "ledger"]);
    expect(mentionedMembers("ask @Home Deals", members)).toEqual(["deals"]);
    expect(mentionedMembers("mail@ledger.com", members)).toEqual([]);
    expect(mentionedMembers("@ledger-two is not Ledger", members)).toEqual([]);
  });

  it("addresses everyone for @all", () => {
    expect(mentionedMembers("@all say hi", members)).toEqual(["brain", "ledger", "deals"]);
  });
});

describe("trailingTotMessages", () => {
  it("counts Tot messages since the last user message, skipping system notices", () => {
    const tot = { kind: "tot", id: brain.id } as const;
    expect(trailingTotMessages([{ kind: "user" }, tot, { kind: "system" }, tot, tot])).toBe(3);
    expect(trailingTotMessages([tot, { kind: "user" }])).toBe(0);
  });
});

describe("decideRoomTurn", () => {
  it("sends an unaddressed user message to the moderator and a named one to who is named", () => {
    expect(
      decideRoomTurn({ ...base, speaker: { kind: "user" }, text: "hello", totMessagesInARow: 0 }),
    ).toEqual({ wake: ["brain"], paused: false });
    expect(
      decideRoomTurn({
        ...base,
        speaker: { kind: "user" },
        text: "@ledger how much?",
        totMessagesInARow: 0,
      }),
    ).toEqual({ wake: ["ledger"], paused: false });
  });

  it("lets a Tot reach only the Tots it names, never itself", () => {
    const speaker = { kind: "tot", id: brain.id } as const;
    expect(decideRoomTurn({ ...base, speaker, text: "no mention", totMessagesInARow: 1 })).toEqual({
      wake: [],
      paused: false,
    });
    expect(
      decideRoomTurn({ ...base, speaker, text: "@Brain and @Ledger", totMessagesInARow: 1 }),
    ).toEqual({ wake: ["ledger"], paused: false });
  });

  it("stops a chain at the hop limit and says so", () => {
    const speaker = { kind: "tot", id: ledger.id } as const;
    expect(decideRoomTurn({ ...base, speaker, text: "@Brain", totMessagesInARow: 3 })).toEqual({
      wake: ["brain"],
      paused: false,
    });
    expect(decideRoomTurn({ ...base, speaker, text: "@Brain", totMessagesInARow: 4 })).toEqual({
      wake: [],
      paused: true,
    });
    expect(
      decideRoomTurn({ ...base, speaker, text: "@Brain", totMessagesInARow: 2, hopLimit: 2 }),
    ).toEqual({ wake: [], paused: true });
  });

  it("ignores system messages", () => {
    expect(
      decideRoomTurn({
        ...base,
        speaker: { kind: "system" },
        text: "@Brain",
        totMessagesInARow: 0,
      }),
    ).toEqual({ wake: [], paused: false });
  });
});
