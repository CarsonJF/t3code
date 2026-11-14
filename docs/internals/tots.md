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

## Faces

The web renders BoopFace directly and always loads its full build: the lite and full builds both define `<boop-face>`, and the full build fetches skin code only when a skin is used. Mobile cannot run a Web Component natively, so it runs one WebView for the Tots tab's moving face (bundled like the device stream script) and draws still faces with `react-native-svg` in lists.
