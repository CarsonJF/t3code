# Tots

Tots are agent threads that act with the user's reach across projects and linked environments. User guide: [Tots](../user/tots.md).

## Where they live and who may act

- Tots live in `ServerSettings.tots` on one host server. Clients cannot patch the field: it is not in `ServerSettingsPatch`, and only `TotService` writes it, through `ServerSettingsService.updateTots`.
- Nothing depends on the desktop app. A Tot reaches other environments through [peer links](./remote.md#peer-links), not through a renderer, so it keeps working with every window closed.
- The grant is "this thread is a Tot's current `threadId`", read on every MCP call ([`totCaller.ts`](../../apps/server/src/mcp/totCaller.ts)). Turning a Tot off or starting fresh moves the grant first, then holds the old thread's queue (`queue.hold`, under the orchestrator's thread lock) and interrupts its run.
- **On a linked environment**, a call is a Tot's when the session is a full-access peer link and its `T3-Sender-Thread` id starts with `tot:`. A full-access link is not fenced anyway, so its sender is taken at its word; a narrower link's is not. That one rule gives the receiving side launched-thread ids, "Sent by" labels, approvals and quiet notifications, with no extra header.
- Scope is focus, not a fence: it is written into the Tot's `AGENTS.md` and bounds `watch_all`, but tools do not refuse out-of-scope calls. Separation comes from separate threads and folders.
- A Tot's project holds only its own thread: `ThreadLaunchService.launch` refuses any other new thread there, and clients leave Tot projects out of project pickers (`withoutTotProjects`).
- Memory is plain files in the Tot's folder (`MEMORY.md`, `memory/`), which the Tot reads and edits with its own file tools. That works for every provider, survives a fresh start, and lets the user read and edit it. `TotService` rewrites every set-up Tot's `AGENTS.md` at start and whenever the Tots change, so instructions and the list of fellow Tots never go stale.

## Ids

Tot threads start with `tot:<totId>:`, threads a Tot launches with `tot-launched:<totId>:`, and watch reports with `tot-report:`. The prefix travels with the thread, so any client can label it and leave it to its owner without knowing the host's settings, and without racing them. `watch_all` skips threads another Tot owns.

## Watches

Watches live on the Tot and are evaluated on the host ([`TotWatchService`](../../apps/server/src/tots/TotWatchService.ts)):

- Local threads are read from domain events.
- Remote threads get a follower that loops the forwarded `t3_thread_wait` with `until: "attention"`, which also returns when a run stops to ask. After a look that did not time out, the follower rests (`TotFollowPause`), because the wait returns at once until a new run starts.
- A first sighting is a baseline for watches the Tot asked for and for `watch_all`, so starting up never replays old state. Watches for work the Tot started compare with an empty state, so their first question is not missed.
- A `sent` watch covers only the run one Tot started in another Tot's thread, so a coordinator is not woken by the user talking to that Tot directly.
- Reports are batched and re-check that the Tot thread they were meant for is still current.

## Group chats

A group chat is a host-owned record in `ServerSettings.groupChats` (written only by [`GroupChatService`](../../apps/server/src/tots/GroupChatService.ts)) and one room thread, `tot-room:<id>`.

- **The room runs no agent.** A thread is one agent session and every message sent to one starts or queues a run, so a shared room cannot be an ordinary thread. The orchestrator recognises the id prefix in `message.dispatch` (`dispatchRoomMessage`) and records the message as `message.updated` and `turn-item.updated` with `runId: null`: no run, no provider turn, no queue. Those events and fields already existed, so stored history and older clients decode it. Anything that sends a message the usual way (the composer on every client, `sendToThread`) lands in the room through the same path, except that `sendToThread` expects a run back and so is not used for rooms.
- **Speakers come from `senderThreadId`.** A Tot speaks with `t3_group_chat_say`, which dispatches with the Tot's thread as sender; clients draw a message whose sender is a Tot thread as that Tot, and `createdBy: "system"` as a notice.
- **Members answer from their own threads.** The service watches room messages, asks `decideRoomTurn` ([`groupChatTurns.ts`](../../apps/server/src/tots/groupChatTurns.ts)) who is due, and wakes each with a message in its Tot thread carrying the recent transcript. The user reaches who they name, or the moderator; a Tot reaches only Tots it names, and only until `hopLimit` Tot messages follow one user message.
- Room threads and room projects are hidden from the thread roster and project pickers like Tot ones (`withoutTotThreads`, `withoutTotProjects`). Members are same-host only.

## Webhook listeners

A listener is a scheduled task with a webhook trigger, a `listener` block on its schedule, and a bound thread. `ScheduledTaskService.triggerWebhook` authenticates and filters as usual, then either posts a runless notice or renders the wake prompt and continues through the normal run path.

- A notify delivery dispatches `message.dispatch` with `systemNotice: true`. The orchestrator records one completed `system_notice` turn item with `runId: null` and no message, so it reaches the timeline but never the provider transcript. That is what keeps notify-only free: no run, no provider turn, no queue, no tokens.
- A wake delivery renders the listener template through `renderWebhookPrompt`, so request values keep their `<webhook-data-…>` framing and mention breaking. The task's bound thread follows a Tot to a fresh start through `TotService.moveRoutines`.
- `cooldownSeconds` is an in-memory window per task (reset on restart); drops are logged as the `cooldown` delivery outcome rather than as runs.
- A static `bearer` header check reuses the task's `webhook_secret` column so no migration is needed. It and the signature check are mutually exclusive.
- `t3_tot_webhook_listener` is the one-call creator. It requires a Tot caller, binds the task to the Tot's current thread, defaults to notify, and returns the URL (a secret). The Tot settings panel can list these tasks with `list_scheduled_tasks` and edit the listener fields through `schedule_task`'s webhook schedule.

## Faces

The web renders BoopFace directly and always loads its full build: the lite and full builds both define `<boop-face>`, and the full build fetches skin code only when a skin is used. Mobile cannot run a Web Component natively, so it runs one WebView for the Tots tab's moving face (bundled like the device stream script) and draws still faces with `react-native-svg` in lists.

## Themes

A Tot stores its own theme on its record: `theme?: { css?: string; effect?: string }`, each capped at 20,000 characters by [`tots.ts`](../../packages/contracts/src/tots.ts). `TotService.setTheme` merges one field and leaves the other alone; `""` or null clears that field. A Tot writes its own theme only: `t3_tot_theme_set` takes no Tot id and resolves the caller from its thread, so even a Tot whose scope is all cannot write another's.

- `css` is applied like an environment theme, not as one: the server refuses what [`themeCssLoadsRemoteFiles`](../../packages/shared/src/themeCss.ts) catches, and [`totThemeCss.ts`](../../apps/web/src/components/tots/totThemeCss.ts) parses it into its own constructed sheet, runs the same `stripFetches` guard, and rewrites each selector to start at `[data-tot-id="<totId>"]`. Bare `:root`, `html` and `body` steps become the scope; a qualified step such as `:root.dark` stays as ancestor context so appearance rules still work. `@keyframes` and `@font-face` stay global on purpose. The sheet exists only while that Tot's thread is open, and it never touches the app's own theme sheet.
- `effect` is opaque text. T3 Code stores and returns it, and the client's effect layer reads it; nothing here parses, runs, or renders it.
- The conversation root carries `data-tot-id` and `data-thread-id` ([`totThreadScope.ts`](../../apps/web/src/components/tots/totThreadScope.ts)), whether or not the thread has messages, so CSS never needs `:has()`.
