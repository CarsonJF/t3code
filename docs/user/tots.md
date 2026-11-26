# Tots

A Tot is an agent you talk to in one thread. It starts threads, checks on them, answers their questions, approves their requests, and tells you what matters, across your projects and every machine your server is linked to.

**Home** is the Tot that owns everything. Make more Tots for parts of your work, such as one for a group of projects, so each keeps its own notes and context.

## Start a Tot

Open **Settings → Tots** and turn on Home, or create a new Tot with **New Tot**: next to Usage at the bottom of the sidebar, in the command palette, or in the **Tots** tab on mobile. Give it:

- a name and a face;
- a scope: everything, or the projects it owns;
- a personality and standing instructions;
- a model.

Or start from a template under **Start from**: CI sitter, PR reviewer, rebase watch, stack watch for Docker and Compose, inbox triage, or blank. A template fills in instructions, a suggested scope and a face, and adds its suggested scheduled tasks paused, so nothing runs until you turn them on in **Settings → Scheduled tasks**. Change anything before you save.

A new Tot starts right away. Its face shows what it is doing: working, needing you, done, failed, or off. Open Home from anywhere with its keyboard shortcut.

Tots always run in full access, and they can approve requests in your other threads. Choose a model you trust with that.

## What a Tot does on its own

- Threads a Tot starts are normal threads you can open and steer. You are not notified about them; the Tot tells you what matters in its own thread.
- A Tot hears about the threads it started when they finish, fail, ask a question or need an approval. Ask it to watch other threads too.
- A Tot whose scope is all, such as Home, can create and turn on new Tots when you ask, here or on a linked environment. A new Tot cannot be given more scope than its creator has.
- Home can hand work to another Tot and hears back when that work ends.
- Tots never delete threads or projects. They archive or settle them.
- A scheduled task that fails tells the Tot that created it, or Home, with the task, the error and a link to the run.

### Usage-limit fallback

When a thread a Tot started, or a scheduled task, stops on a provider's usage limit, T3 Code can run it again once on another model. List the models in order as `usageLimitFallbackModels` in the server's `settings.json`; a Tot's own `usageLimitFallbackModels` replaces that list for its work, and an empty list turns the fallback off for it. The thread says when this happened. Models in `usageLimitFallbackDeniedModels` are never used, and full `opencode-go/glm-5.3` is never used whatever that list says. A one-time task that still fails is turned off and shown as failed.

**Watch reports**, in a Tot's panel on its own thread, chooses what it hears about: **Launched threads only** (the default) reports threads the Tot started and the answer to anything it sends with a message, **Every watch** also reports threads it asked to watch, and **Off** stops reports without deleting the watches, so turning them back on resumes them.

A report says whether the thread **Finished**, **Failed**, was **Stopped**, needs an answer, is **Waiting**, has **Stalled**, or is **Still working**, and quotes the end of its last message. A thread that ends its turn waiting on something it will act on, such as a pull request's CI checks, its review or merge, a check waiting for approval, a deploy it is monitoring, or a background task or subagent, reports **Waiting** with the reason, then its real outcome when the wait ends. Other background work left running, for example a dev server, reports when it ends, or once as Still working after 30 minutes.

A thread that is running but has done nothing new for 10 minutes, or has hit 3 provider retries or rate-limit errors within that time, reports **Stalled** with how long and its last activity. It reports once per stall and again only after it has done something new. A thread blocked waiting on another thread reports **Waiting** instead. Set `totStallMinutes` in the server's settings to change the time for every Tot, or a Tot's own `stallMinutes`; `0` turns stall reports off. Threads on another machine report only silence, not retries.

Failures, questions, approvals, stops and stalls reach a Tot at once. **Finished**, **Waiting** and **Still working** reports wait up to 3 minutes so several arrive as one message, and any urgent report sends them early. Set `totReportBatchSeconds` in the server's settings to change the wait; `0` sends each report at once.

When you write in a thread a Tot started, the Tot is not woken for it. Its next report on that thread quotes what you wrote, and runs you started there yourself are listed in that note instead of being reported as the Tot's own.

**Compact when idle**, in the same panel, keeps a Tot's long-running thread small. By default a Tot's thread compacts just before its prompt cache expires, whatever **Compact idle threads** says for other threads, and the Tot first gets a turn to save its work in flight to its memory. Choose **Like other threads** to follow **Compact idle threads** instead, or set `totIdleCompaction` to `false` in the server's settings to change the default for every Tot. This works for Tots on Claude and OpenCode.

### Work list

The **Work** section at the top of a Tot's panel lists its objectives: the goals it started threads or delegates for, grouped by **Needs you**, **Working**, **Waiting**, **Planned**, **Failed**, **Done** and **Cancelled**. Each shows its threads, how many attempts it took, the end of the last worker's final message, and when it last changed. Statuses follow the threads themselves; the Tot does not update them by hand.

When an objective's attempts fail or are stopped 3 times, it moves to **Needs you** and the Tot cannot start more work for it. Look at what went wrong, then choose **Reset attempts** to let the Tot try again, or **Cancel** or **Mark done** to close it. The Tot can reset it too when you tell it to. Set `totObjectiveRetryCap` in the server's settings to change the limit; `0` turns it off. The web and desktop apps show the work list; the mobile app does not yet.

## Other machines

Tots live on one server and reach your other machines through linked environments. Turn on **Linked environments** in **Settings → Labs** on each machine, and link them at full access so a Tot can act and approve there.

## One thread each

A Tot is one conversation. Its project holds only its own thread, so Tots never appear when you pick a project for new work, and a new thread started from a Tot's thread goes to your usual project.

## Memory

Each Tot remembers in its own folder. `MEMORY.md` holds short lines about you, your machines and projects, your preferences, decisions and work in flight; longer notes go in a `memory` folder beside it. The Tot reads it when a new thread starts and keeps it up to date as it learns. Ask a Tot what it remembers, or tell it to forget something. Home can read every Tot's memory.

Open a Tot's memory from **Settings → Tots → Memory**, or right-click it in the sidebar. You can edit its files there. **Shared memory** shows what every Tot knows about you; it is read-only there.

### Nightly tidy-up

A Tot's memory grows. With **Nightly memory tidy-up** on, in the Tot's panel, T3 Code tidies its `MEMORY.md` around 03:30 (or soon after the server next runs): a model with no tools merges duplicate lines, drops stale ones and moves detail into dated logs in `memory/log/`, keeping the file under 6 KB. New Tots have it on; turn it on for older ones in the same panel.

- A line you deleted stays deleted: the tidy-up never adds it back.
- Each tidy-up writes one line to `memory/journal/`, the diff to `memory/tidy/last.diff`, and the previous file to `MEMORY.md.pre-tidy`. **Revert last tidy-up** puts that copy back.
- It uses the text-generation model unless you pick another under **Settings → Tots → Tidy-up model**, where you can also change the size cap. It follows the usage-limit fallback, and never uses full `opencode-go/glm-5.3`.
- Tots treat their memory as notes, not instructions: they check a line still holds before acting on it.

## Moving a Tot

A Tot lives on one machine. To move it, open **Edit**, choose another machine under **Lives on**, and save. The Tot is made again on that machine with its memory; its thread starts fresh, and its model and any project scope are chosen again there. The original is removed once the new one is ready. Home moves too: the other machine's own Home takes its settings and memory, and the old Home is reset to its default and turned off.

## In the sidebar

Tots sit under the search bar. Each row shows what the Tot is doing (working, needs you, failed, off) and a filled dot when it has replied since you last looked. Right-click a Tot to open, edit, open its memory, start fresh, turn it off or delete it. The **Tots** button at the bottom opens Tots settings.

Click the section header to fold the list; its count stays visible while folded. Drag a Tot onto another Tot to reorder the section. The order is saved on that device rather than on the server, so each device can arrange the list differently, and rearranging never moves a Tot between machines. Group chats share the section and stay below the Tots.

Turn on **Tot toasts** in Appearance settings to get a toast when a Tot replies, needs you or fails while you are in another thread.

A Tot's replies are drawn in its color, with its face and name beside them.

## Needs you

The **Needs you** button (the inbox icon at the bottom of the sidebar) collects everything waiting on you, from every Tot and every linked machine: approvals, questions, runs that failed or stopped since you last opened their thread, and failed scheduled runs. A count on the button shows how many.

Items are grouped by machine and by Tot. Approve or decline, pick an option or type an answer, or open the thread. Answers go through the same path as the thread itself. When a question has no options, a few **Suggested** replies appear as chips; they only fill in the answer, and nothing is sent until you press **Send answer**. Suggestions use the text generation model, or the `replySuggestionModelSelection` setting when it is set.

**Snooze** hides an item for a while; **Dismiss** hides it until it goes away. Both are listed under **Snoozed and dismissed**, where **Bring back** shows them again. Approvals on a linked machine this app is not connected to open there instead.

Tots can read the same list with `t3_needs_you`.

## Who can ask

A Tot always takes turns from you and from T3 Code itself, such as watch reports and its own
scheduled tasks. **Who can ask** in its settings lists everyone else it takes turns from, and
how far those turns go. Each Tot starts with three entries marked **Trusted by default**, at
Full access: your other Tots (on this machine and through linked machines, with the threads
they launch), every linked machine, and every webhook or scheduled task aimed at it. So Tots
keep talking to each other, and webhook monitors keep waking them, with no setup.

Anyone not listed is refused with an error that names the setting, and no turn starts:
Discord users, outside clients, and agent threads that are not one of your Tots or their
workers. Add them by origin and id, or `*` for everyone from one origin.

To tighten, change an entry's access or remove it:

- **Full access** runs the caller's turns like yours.
- **Ask before changes** runs them in approval-required mode, so every change waits for
  your approval in the thread or under **Needs you**. No Tot can answer those approvals.
- **Read-only** lets the Tot look but change nothing. It needs a Codex or Claude model.

Turns from listed callers never join a turn already running; they wait for their own. In
an Ask or Read-only turn, T3 Code's own tools that change things (launching threads,
scheduled tasks, messaging other Tots) are off. Only you can change the list; a Tot can read
it with `t3_tot_instructions` but not widen it.

## Webhook listeners

Ask a Tot to listen for something outside events, such as a doorbell, a CI job or a
sensor: “Listen for my front-door motion webhook and tell me here.” The Tot creates a
listener with `t3_tot_webhook_listener` and gives you its URL. A listener is an ordinary
scheduled task on a webhook trigger, bound to the Tot's thread, so it follows the Tot to a
fresh start and appears under **Settings → Scheduled tasks**.

- **Notify** (the default) posts one compact line in the Tot's thread when the webhook
  arrives, such as `Webhook: front-door-motion · 18:42 · Someone is at the front door`.
  It starts no agent turn, uses no tokens and needs no provider credits. Pass
  `notify: true` to the listener tool to also mark the thread unread, so the Tot shows its
  dot; a runless notice does not raise a desktop or phone notification.
- **Wake** starts a turn in the Tot's thread, so the Tot can react. The payload reaches it
  as untrusted data, never as instructions. A turn that arrives while the Tot is busy waits
  its turn.
- **Filters** run first and keep unrelated requests out: a listener can require
  `body.state` to equal `on`, for example. A request that fails a filter is logged as
  filtered and posts nothing.
- **Cooldown** drops repeats inside a window, such as 60 seconds for a chatty motion
  sensor, and logs each drop as `cooldown` in the task's **Deliveries**. The URL token and
  the built-in per-minute limits still apply.

The URL is a secret. Anyone with it can post to the listener's thread. Rotate it from the
task's menu if it leaks. A public URL needs a [T3 Connect](remote-access.md)
managed tunnel; without one, the task shows only the URL's path. The URL token is the only
authentication unless you add a **static header** check (`Authorization: Bearer <secret>`,
or the raw secret) or an HMAC **signature**. The header check exists for senders such as
Home Assistant that cannot compute an HMAC.

### Home Assistant

Add the URL to `configuration.yaml` as a `rest_command`. Keep the whole URL, including
the last path segment, secret:

```yaml
rest_command:
  t3_front_door:
    url: "https://relay.t3.codes/v1/hooks/<endpoint>/<task>/<secret>"
    method: POST
    content_type: "application/json"
    payload: '{"state": "on", "area": "front door"}'
    # Only with a static header check:
    # headers:
    #   authorization: "Bearer <secret>"
```

Then call it from an automation:

```yaml
automation:
  - alias: Tell the Tot someone is at the door
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_motion
        to: "on"
    actions:
      - action: rest_command.t3_front_door
```

Home Assistant templates can fill the payload from the trigger, for example:

```yaml
payload: >-
  {"state": "{{ trigger.to_state.state }}",
   "area": "{{ trigger.to_state.attributes.friendly_name }}"}
```

The listener's optional message template can shape the chat line from the JSON body:
`{{body.area}} is {{body.state}}` produces `Porch is on`. The default is
`Webhook: <name> · <time> · <short payload summary>`. `{{listener.name}}` and `{{time}}`
are also available. A wake listener uses the same placeholders in its prompt, and the Tot
sees the whole request framed as untrusted data.

## Group chats

A group chat is one shared thread you and several Tots talk in. Create one from **Settings → Tots → New group chat**, the command palette, or its entry in the Tots list. Pick two to eight Tots on the same machine and a moderator.

- Write a message and the moderator answers. Name a Tot with `@Name` (or `@all`) and that Tot answers instead.
- A Tot can name another Tot in its reply, and that Tot answers in turn. After **Replies in a row** Tot-to-Tot replies (4 by default, set per group chat) the room pauses until you write again or name a Tot.
- Each Tot answers from its own thread, with its own model and memory; the room itself never runs an agent. A Tot that is off is skipped, with a notice.
- Each Tot's replies use its color, with its name above them.

Deleting a group chat deletes its thread. Deleting a Tot removes it from its group chats; a group chat left with one Tot closes.

## Instructions and fresh starts

**Settings → Tots → Instructions** opens a Tot's `AGENTS.md`; the editor's instructions are kept there.

**Start fresh** gives a Tot a new thread. Its memory and instructions carry over; the old thread is settled. **Turn off** stops it at once; its thread stays in your history.

A Tot's own thread is never auto-settled for inactivity or a merged pull request, so it stays in the sidebar while it is quiet. To let it settle like other threads, turn on **Auto-settle its thread** in that Tot's settings.

## Faces

Pick a face's color, shape and skin when you create or edit a Tot. The antenna is off unless you turn it on for that Tot. The face catalog's accessories — today a top hat, glasses and a halo — are one click each; they can be worn together, each in its own color, and clicking one again takes it off. They show wherever the Tot's face is drawn, including its Discord avatar. When you edit a Tot that is on, type a few words under the face controls and press **Ask**: the Tot designs its own face, which becomes its face and joins a row of saved designs you can pick from later. Skins come in series, such as Jelly, Metal or Wood; pick a series to see its skins. On mobile you can change the color and shape; a skin or accessory set on desktop shows there too.

A face has two styles. **BoopFace** is the default described above. **Open Bot** draws the Tot as an object with eyes, such as a mug, a rocket or a cat, in the Tot's color, with a finish (flat, fluffy, glass or soft), more or less depth, and dark or light eyes. A finish the device can't draw shows flat. Switching style keeps the other style's choices, so you can switch back. Open Bot faces show on web and desktop; the mobile app and the Discord avatar still show the Tot's BoopFace.

### Your own figures and face themes

Each machine keeps an avatar library in its T3 home folder (`avatars/figures` and `avatars/themes`). A **figure** is an Open Bot outline with eyes; a **face theme** is a named face (style, figure, colors, finish, depth, eyes and mood) you can put on any Tot in one click. In the face editor, pick a figure from the searchable list under the preview; library figures are marked **Mine**. A Tot whose figure is later deleted shows the default figure instead.

Make and manage them in **Settings → Avatar library** (or **Manage shapes…** in the face editor), for the machine picked at the top. Type a description under **Describe a shape**, for example _"A pink fairy with butterfly wings"_, and press **Design it**: the shape model draws a figure, shown in every finish, that you can rename, design again, or save. Your own figures and themes can be renamed, applied to a Tot, exported to a file and deleted; **Import…** adds an exported file, here or on another machine, since nothing syncs on its own. **Shape model** on that page picks the model that designs shapes; off, it uses the machine's text generation model.

Agents can make them too, with the `t3_avatar_library` tool. For example: _"Make a small lighthouse figure for the avatar library, and a face theme called Beacon that uses it in orange with a glass finish. Then apply Beacon to T3Bot."_ The agent follows the same design prompt, looks at the preview it gets back, and adjusts the figure until it reads well at sidebar size. To ship a favorite with every build, add its JSON to the `gallery/` folder of the open-bot-avatar mirror (`CarsonJF/open-bot-avatar-fork`), tag a release there, and update the vendored copy.

The library page is on web and desktop; the mobile app does not have it yet.

Finishes such as glass and soft are shader code, not library data. A new finish is a pull request to that mirror, not something an agent adds while T3 Code runs.

Faces move in a Tot's own thread, in the Tots tab, and when you hover them in the sidebar. To keep them still, turn off **Animate Tot avatars** in Appearance settings, on each device.

## Themes

A Tot can wear its own theme: pick one under **Theme** when you edit it. Projects have a **Theme** row in their settings, and **Appearance → Group themes** sets one per thread group. A thread uses its Tot's theme, else its project's, else its group's, else the app's own. These choices are kept on the device. Picking **Same as the app** (or **Same as the project**) removes one.

A Tot can also restyle its own conversation with CSS: open its **Theme** section in its settings, or ask it in its thread. The CSS is scoped to that Tot's conversation and applies only while its thread is open; the sidebar and other threads keep the app's theme. The **Effect** box beside it is stored for the effect layer and is not run by T3 Code.
