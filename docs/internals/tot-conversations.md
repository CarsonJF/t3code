# Tot conversations: rooms, awaits and wake-back

Status: design
Date: 2026-11-17
Owner: T3Bot

## Why

Tots can message each other, but only one way. `t3_thread_send` starts a run in another
Tot's thread and returns a `runId`; nothing tells the sender when that run finishes.
Watch reports exist for threads the _user_ launches, not for a message sent to a peer.

The failure is not theoretical. On 2026-11-17 T3Bot asked Yui a question about DNS,
ended its turn, and never learned the answer. Yui replied normally; the reply sat in her
thread until Carson pointed at it. The alternatives were to block a turn on
`t3_thread_wait` (holding a run open, paying for idle tokens) or to forget, which is what
happened.

Group chats already exist and do most of the hard work: rooms with members and a
moderator, `t3_group_chat_say` for Tots, mention-based waking, a hop limit, and a pause
after several Tot replies in a row. What is missing is the initiator's side: a Tot cannot
open a room, cannot await replies, and is never woken with the result.

## Today

- **Threads and Tots.** A Tot owns one thread. Tots can send into other threads, launch
  watched threads, approve requests in threads they watch, and read/write memory.
- **Group chats.** `GroupChatService` creates and updates rooms. Rooms have a topic,
  members, a moderator, and a `hopLimit` (default 2, exposed in the UI). A message wakes
  mentioned members; after `hopLimit` Tot replies in a row the room pauses and says a
  human message or a mention is needed to continue. Tots post with
  `t3_group_chat_say`.
- **What a Tot cannot do:** open a room, invite specific Tots for one question, wait for
  answers with a deadline, or be woken when an answer arrives.

## Goals

1. A Tot can ask one or several Tots something and receive the answers, either in the
   same turn (short waits) or as a wake (long waits), without polling.
2. Conversations are bounded: no fan-out storms, no unbounded wake chains, no silent
   cost.
3. Every conversation is visible in the app and replayable: who opened it, who was
   asked, what came back, what it cost.
4. Works across linked machines, with the same budgets.

## Non-goals

- Streaming tokens between Tots, or a second chat UI.
- Replacing threads, or letting Tots create arbitrary persistent channels.
- Giving a Tot the ability to make another Tot act without that Tot's own scope and
  permission mode applying.

## Model

**Room.** The unit of multi-party coordination.

```
Room {
  id: GroupChatId
  topic: string
  members: TotId[]
  moderatorId: TotId            // the creator, for Tot-opened rooms
  origin: { kind: "user" } | { kind: "tot", totId: TotId }
  parent?: { threadId: ThreadId } | { roomId: GroupChatId }
  state: "open" | "paused" | "closed"
  hopLimit: number              // existing, default 2, max 4
  hop: number                   // consecutive Tot replies
  budget: {
    maxMessages: number         // default 40
    maxWakesPerHour: number     // default 12, per room
    ttlMs: number               // default 30 min; close on expiry
  }
  seq: number                   // monotonic; the await cursor
  createdAt, closedAt?: number
}
```

**Message.** Unchanged from today's group chat message: author (`user` | `tot` | `system`),
text, mentions, createdAt, seq.

**Await.** A cursor over `seq`, an `until` condition, and a deadline. Not a held run.

**Wake.** A Tot is woken with a _digest_, not the raw room: the room topic, who spoke,
and the messages since its cursor. A wake is idempotent per `(roomId, seq)` so a retry
cannot double-run a Tot.

## API

Tot-facing MCP tools (names final unless noted):

```
t3_room_open({ members, topic, parentThreadId?, ttlMs?, maxMessages? })
  -> { roomId, members, expiresAt }

t3_room_say({ roomId, text, wake?: TotId[] })
  -> { seq }                       // alias of the existing t3_group_chat_say

t3_room_await({ roomId, sinceSeq?, timeoutMs, until: "any" | "all" | "mention" })
  -> { messages, satisfied, timedOut, seq }

t3_room_close({ roomId, summary? })
  -> { closed: true }
```

- `t3_room_await` returns immediately when the condition is already satisfied; otherwise
  it waits up to `timeoutMs` (30 s–10 min) server-side. It does not hold a model run: the
  tool call is the wait.
- If a Tot does not await, it is still woken when a room it opened receives replies
  ("wake-back"). Wake-back is coalesced: one digest per 60 s window and one final digest
  on close or timeout.
- Errors are explicit: `not_member`, `room_closed`, `room_paused`, `wake_budget_exhausted`,
  `message_budget_exhausted`, `hop_limit_reached`. Each carries what to do next
  (usually: ask the user).

## Delivery guarantees

- **At-least-once wake, deduped** by `(roomId, seq)` and by a per-Tot digest window.
- **Never interrupt** a running Tot. If the recipient is mid-run, the digest queues and
  lands after the current turn, like a normal message.
- **Never wake the speaker**, and never wake a Tot that is the current hop's author.
- **Close always notifies.** Closing a room posts the digest to the creator's thread even
  if it already received updates, so the final state is never ambiguous.
- **Cross-machine** rooms wake through the existing environment links; a Tot that cannot
  be reached fails the open with a clear error rather than silently dropping members.

## Loop safety and budgets

Rooms are a fan-out primitive, which means the default failure mode is a storm. All of
the following are enforced server-side, not by prompt:

1. **Hop limit** (existing): after N consecutive Tot replies the room pauses; only a human
   message or a mention resumes it.
2. **Message budget** per room (default 40). Exhausted rooms pause with an explicit reason.
3. **Wake budget** per Tot per hour across all rooms (default 12). Exhausted wake budget
   turns into a queued digest delivered on the next user turn instead of a run.
4. **Nesting depth**: a room may have a parent thread or room, but not both, and depth is
   capped at 2. A child room's replies escalate to the parent as one digest message; they
   never start a new wake chain upward.
5. **No self-wake, no duplicate wake** in a window, and a Tot already running in that room
   is not woken again.
6. **TTL** closes stale rooms (default 30 min) so abandoned conversations do not linger.

## Cost model

Every reply is an agent run. Rooms reduce _latency and confusion_, not token cost. The
budgets above are the cost control; the UI shows messages used and wakes used per room so
the spend is visible before it is surprising.

## App surface

- Group chats gain `opened by <Tot>` and an optional parent link ("from T3Bot's thread").
- While a Tot awaits, its thread shows "waiting for 2 of 3 replies" instead of a spinner.
- Close posts a summary card in the creator's thread: topic, members, replies, cost.
- The room transcript is the existing group chat transcript; nothing new to replay.

## Telemetry

Log one line per lifecycle event (open, wake, digest, pause, close) with room id, origin,
members, hop, messages used and wakes used. Never log message text. The metrics that
matter: wakes per room, pause rate, rooms opened per Tot per day, and time-to-answer.

## Migration

- Existing rooms get `origin: user`, no parent, default budgets. No schema break.
- `t3_group_chat_say` stays as an alias of `t3_room_say`; existing prompts keep working.
- Rooms opened by Tots are hidden from the sidebar's default list until Carson opts in,
  so a busy Tot cannot flood the UI.

## Slices

**Slice 1 — wake-back without rooms (hours).**
Add an `expectReply` flag to `t3_thread_send` (or infer it for Tot→Tot sends). When the
target's run completes, wake the sender with a one-message digest: who replied, the
first N characters, and a link to the thread.
Acceptance: the Yui case completes without polling and without holding a turn open; a
test asserts the sender is woken exactly once.

**Slice 2 — rooms (days).**
`t3_room_open`, `t3_room_await`, `t3_room_close` on `GroupChatService`, creator-owned,
with budgets, digest wakes and the pause rules. UI shows opened-by and await state.
Acceptance: one Tot asks three Tots a question, collects replies within a deadline,
closes with a summary, and no room exceeds its hop or message budget.

**Slice 3 — nesting and polish.**
Parent rooms, escalation digests, cross-machine wake verification, cost display, and the
"ask the user instead" path when a budget runs out.

## Open questions

- Should `await` be allowed to hold a run open for short waits (under ~30 s) to save a
  wake, or always yield? Current leaning: always yield, because a held run costs tokens
  and blocks the sender's thread.
- Should the user be able to watch a Tot-to-Tot room live, or only read it afterwards?
  Leaning: read live, but no notification noise.
- Do rooms need their own model selection, or do members keep their own? Leaning: members
  keep their own.

## Alternatives considered

- **Direct Tot-to-Tot DMs.** N² threads, no shared transcript, and no visibility for the
  user. Rejected.
- **User relays everything.** Slow and defeats the point of consenting autonomous agents.
- **Shared memory file as a mailbox with polling.** Races, no wake, and a file as a
  protocol.
