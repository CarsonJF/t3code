import type { TotId } from "@t3tools/contracts";

export interface RoomMember {
  readonly id: TotId;
  readonly name: string;
}

/** Who wrote the message a room reacts to. */
export type RoomSpeaker =
  | { readonly kind: "user" }
  | { readonly kind: "tot"; readonly id: TotId }
  | { readonly kind: "system" };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EVERYONE = /(^|[^\w])@(all|everyone)(?![\w-])/i;

/** Members an `@name`, `@id` or `@all` in the text addresses, in member order. */
export function mentionedMembers(
  text: string,
  members: ReadonlyArray<RoomMember>,
): ReadonlyArray<TotId> {
  if (EVERYONE.test(text)) return members.map((member) => member.id);
  return members
    .filter((member) =>
      [member.name, member.id].some((label) =>
        new RegExp(`(^|[^\\w])@${escapeRegExp(label)}(?![\\w-])`, "i").test(text),
      ),
    )
    .map((member) => member.id);
}

/** Consecutive Tot messages at the end of the room, which a user message resets to zero. */
export function trailingTotMessages(speakers: ReadonlyArray<RoomSpeaker>): number {
  let count = 0;
  for (let index = speakers.length - 1; index >= 0; index -= 1) {
    const speaker = speakers[index]!;
    if (speaker.kind === "tot") count += 1;
    else if (speaker.kind === "user") break;
  }
  return count;
}

export interface RoomTurnDecision {
  readonly wake: ReadonlyArray<TotId>;
  /** A Tot asked for another Tot, but the chain has reached the room's limit. */
  readonly paused: boolean;
}

/**
 * Who answers the message a room just received. The user reaches whoever they name, or the
 * moderator. A Tot reaches only the Tots it names, and only until `hopLimit` Tot replies have
 * followed one user message, so Tots cannot keep each other busy.
 */
export function decideRoomTurn(input: {
  readonly speaker: RoomSpeaker;
  readonly text: string;
  readonly members: ReadonlyArray<RoomMember>;
  readonly moderatorId: TotId;
  /** Tot messages in a row at the end of the room, this one included. */
  readonly totMessagesInARow: number;
  readonly hopLimit: number;
}): RoomTurnDecision {
  const { speaker } = input;
  if (speaker.kind === "system") return { wake: [], paused: false };
  const mentioned = mentionedMembers(input.text, input.members);
  if (speaker.kind === "user") {
    return { wake: mentioned.length > 0 ? mentioned : [input.moderatorId], paused: false };
  }
  const named = mentioned.filter((id) => id !== speaker.id);
  if (named.length === 0) return { wake: [], paused: false };
  if (input.totMessagesInARow >= input.hopLimit) return { wake: [], paused: true };
  return { wake: named, paused: false };
}
