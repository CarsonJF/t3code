# Tot conversations: rooms, awaits and wake-back

Status: design, revision 2 (reviewed by Opus, 18 Nov 2026)
Owner: T3Bot

## Why

Tots can message each other, but the reply never comes back. On 2026-11-17 T3Bot asked
Yui a question with `t3_thread_send`, ended its turn, and never learned the answer until
Carson pointed at it.

Revision 1 of this doc blamed a missing mechanism. That was wrong. The mechanism exists:
`t3_thread_send` already records a `sent` watch for the run it starts
(`apps/server/src/mcp/toolkits/orchestrator/handlers.ts:197-200`, `:263-273`), and
`TotWatchService.observe` already reports when that run ends
(`apps/server/src/tots/TotWatchService.ts:187-201`). What happens is a setting: `sent`
reports are dropped unless the Tot's `watchReports` is `explicit`
(`apps/server/src/tots/totWatchReports.ts:74-76`), and every Tot on Asuna uses the
default, `launched`. The watch is then removed when the run ends whether or not a report
went out (`TotWatchService.ts:191-193`), so the answer disappears silently.

So the work is smaller than revision 1 assumed, and the dangerous part is different: a
`sent` report that reaches its sender is a new wake, and nothing rate-limits it.

## Today

- **Threads and Tots.** A Tot owns one thread. Tots send into other threads, launch
  watched threads, approve requests in threads they watch, and read/write memory.
- **Watch reports.** Three reasons: `launched`, `requested`, `sent`. `sent` covers a
  `t3_thread_send` into another Tot's thread; it is recorded and gated by the report
  setting.
- **Group chats.** `GroupChatService` keeps rooms in `ServerSettings.groupChats`: topic,
  members, moderator, hop limit. The code default is 4, maximum 12
  (`packages/contracts/src/groupChats.ts:19-20`), not 2/4. Only a user message resets the
  hop count (`groupChatTurns.ts:39`); a Tot mention never resumes a paused room
  (`:72`). A Tot posting without an @mention wakes nobody (`:70-71`). Each room also
  creates a managed project and thread (`GroupChatService.ts:114-132`). `say` refuses
  linked callers (`apps/server/src/mcp/toolkits/tots/handlers.ts:64-68`). `say` returns
  nothing today.
- **What is missing:** delivery of `sent` reports under the default settings, watch
  removal scoped to a run, a rate cap on peer wakes, Tot-opened rooms, and a digest wake
  for room replies.

## Goals

1. A Tot can ask one or several Tots something and receive the answers, in the same turn
   for quick replies or as a wake for slow ones, without polling.
2. Conversations are bounded: no peer ping-pong, no fan-out storms, no silent cost.
3. Every conversation is visible in the app and replayable: who opened it, who was
   asked, what came back, what it cost.
4. Slice 1 works across linked machines. Rooms across machines are a later, schema-level
   change (see Cross-machine).

## Non-goals

- Streaming tokens between Tots, or a second chat UI.
- Replacing threads, or letting Tots create arbitrary persistent channels.
- Letting a Tot make another Tot act outside that Tot's own scope and permission mode.

## Model

**Room.** The unit of multi-party coordination.

```
Room {
  id: GroupChatId              // generated, never derived from the name
  topic: string
  members: TotId[]             // local ids today; environment-scoped ids are a later schema change
  moderatorId: TotId           // the creator for Tot-opened rooms
  origin: { kind: "user" } | { kind: "tot", totId: TotId }
  parent?: { threadId: ThreadId } | { roomId: GroupChatId }
  state: "open" | "paused" | "closed"
  hopLimit: number             // existing, default 4, max 12
  budget: { maxMessages: number; ttlMs: number }
  createdAt, closedAt?: number
}
```

Not in settings: `seq`, `hop`, messages used and wakes used. Every settings write prunes
and syncs followers (`GroupChatService.ts:375-376`, `TotWatchService.ts:387-388`), and
`hop` is already derived from the transcript (`groupChatTurns.ts:34-42`); storing either
would race. Use the orchestration event sequence for ordering instead of the current
`createdAt` + random id (`GroupChatService.ts:307-313`), and keep per-message counters in
memory.

## API

```
t3_room_open({ members, topic, parentThreadId?, ttlMs?, maxMessages? })
  -> { roomId, members, expiresAt }

t3_room_say({ roomId, text, wake?: TotId[] })
  -> { seq }                  // alias of today's t3_group_chat_say, which returns nothing yet

t3_room_await({ roomId, sinceSeq?, timeoutMs, until: "any" | "all" | "mention" })
  -> { messages, satisfied, timedOut, seq }

t3_room_close({ roomId, summary? })
  -> { closed: true }
```

Errors need real codes first: today `GroupChatError` carries only a message and surfaces
as `invalid_request` (`packages/contracts/src/groupChats.ts:88-90`,
`apps/server/src/mcp/toolkits/tots/handlers.ts:73-74`). Add `not_member`, `room_closed`,
`room_paused`, `wake_budget_exhausted`, `message_budget_exhausted`, `hop_limit_reached`.

## Delivery

- **Best effort, not at-least-once.** The report waits in a 2 s in-memory outbox
  (`TotWatchService.ts:38`, `:191`, `:366-381`); a restart inside that window loses it.
  Remove the watch only after the report succeeds.
- **One watch per run.** `addWatch` keeps one watch per run
  (`apps/server/src/tots/TotService.ts:465-468`) but `removeWatch` deletes every watch on
  the thread (`:479-481`). Two sends to the same thread therefore lose the second wake;
  remove by `runId` when the reason is `sent`.
- **Wakes steer, they do not queue.** `TotService.report` and `GroupChatService.wake`
  send in `auto` mode (`GroupChatService.ts:289`), which steers an active run
  (`ThreadManagementService.ts:904-905`). For slice 1 that is right — the answer lands in
  the turn that asked — but the doc must say so, and the digest can quote the target's
  reply to a different run when it was busy.
- **No self-wake, no duplicate wake** for the same run, and a `sent` report never wakes a
  Tot whose current run was itself started by a watch report.

## Loop safety

The `t3_thread_send` loop is the dangerous one, and revision 1 missed it entirely: A
sends to B and is watched; B replies with a send to A and is watched; both ends keep
waking each other, and a polite "thanks / you're welcome" is enough.

Server-enforced, not prompt-enforced:

1. **Per-pair rate cap** on `sent` reports, per sender→target pair per hour, kept in
   `TotWatchService`.
2. **No `sent` watch** when the sender's run was itself started by a watch report.
3. **Hop limit** (existing): default 4, max 12; only a user message resets it. A Tot-opened
   room that pauses can only be resumed by the user — say so in the room.
4. **Per-Tot wake budget** across all rooms, not per room (revision 1 contradicted
   itself). Exhausted wakes become a queued digest for the next user turn; nothing hooks
   a user turn today, so that hook has to be built for slice 2.
5. **Message budget** per room, default 40, kept in memory.
6. **Nesting depth** capped at 2; a child room escalates to its parent as one digest, never
   a new wake chain.
7. **TTL** closes stale rooms (default 30 min) by archiving their thread, never deleting
   it — `remove` sends `thread.delete` today (`GroupChatService.ts:175-181`).

## Cross-machine

Slice 1 holds across linked machines: a send to a remote thread is followed by polling,
with a wait of up to 10 minutes plus a 30 s pause (`TotWatchService.ts:233-320`), behind
the same setting gate (`:297-302`). A remote Tot calling in gets no local watch
(`handlers.ts:269`) because its own machine registers one through `afterForwarding`.

Rooms do not hold across machines today: `say` refuses linked callers, members are local
`TotId`s checked against the local list (`GroupChatService.ts:97`). Environment-scoped
members are a schema change and belong in slice 3.

## App surface

- Group chats gain `opened by <Tot>` and an optional parent link.
- A room is heavy — it creates a managed project and thread. A one-off question should
  not; slice 2 should let a room use the opener's thread instead of provisioning one.
- While a Tot awaits, its thread shows "waiting for 2 of 3 replies".
- Close posts a summary card in the creator's thread: topic, members, replies, cost.

## Cost

Every reply is an agent run; rooms buy latency and clarity, not free tokens. The per-pair
cap and the per-Tot wake budget are the cost control.

## Migration

- Optional fields on `GroupChat` are safe (the pattern already exists: `watchReports`,
  `packages/contracts/src/tots.ts:153`). No counter moves into settings.
- `t3_group_chat_say` stays as an alias of `t3_room_say`.
- Tot-opened rooms are hidden from the default sidebar list until Carson opts in.

## Slices

**Slice 1 — deliver the wake we already record (about half a day).**
(a) let `sent` reports through under the default setting
(`totWatchReports.ts:76`, update `TotWatchService.test.ts:201`); (b) remove watches by
`runId`; (c) per-pair rate cap; (d) optionally, put the first N characters of the
target's last reply in the report so the sender need not call `t3_thread_read`.
Acceptance: the Yui case completes without polling and without holding a turn open; a
test asserts exactly one wake, and a test asserts the ping-pong stops at the cap.
Risks: the loop (must have c), the lost second wake (must have b), and mid-run steering.

**Slice 2 — rooms.** `t3_room_open`, `t3_room_await`, `t3_room_close` on
`GroupChatService`, creator-owned, counters in memory, generated room ids, digest wake in
`GroupChatService.react` (not `say`, which wakes nobody without a mention), archive on
close, no extra project for one-off rooms.

**Slice 3 — nesting, cross-machine rooms and polish.** Parent rooms and escalation
digests, environment-scoped members, cost display, the "ask the user instead" path.

## Open questions

- **`sent` reports on by default?** Recommendation: yes, with the per-pair cap, because
  the whole point is Tots answering each other; it is one field per Tot and can be turned
  off. The alternative — setting `explicit` on T3Bot only — fixes today's case and hides
  the loop, which is worse.
- Should `await` hold a run open for short waits, or always yield? Leaning yield.
- Should the user watch a Tot-to-Tot room live, or read it afterwards? Leaning read live,
  no notification noise.

## Alternatives considered

- **Direct Tot-to-Tot DMs.** N² threads, no shared transcript, no user visibility.
- **User relays everything.** Slow and defeats consenting autonomous agents.
- **Shared memory file as a mailbox.** Races, no wake, a file as a protocol.
