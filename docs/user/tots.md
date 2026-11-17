# Tots

A Tot is an agent you talk to in one thread. It starts threads, checks on them, answers their questions, approves their requests, and tells you what matters, across your projects and every machine your server is linked to.

**Home** is the Tot that owns everything. Make more Tots for parts of your work, such as one for a group of projects, so each keeps its own notes and context.

## Start a Tot

Open **Settings → Tots** and turn on Home, or create a new Tot with **New Tot**: next to Usage at the bottom of the sidebar, in the command palette, or in the **Tots** tab on mobile. Give it:

- a name and a face;
- a scope: everything, or the projects it owns;
- a personality and standing instructions;
- a model.

A new Tot starts right away. Its face shows what it is doing: working, needing you, done, failed, or off. Open Home from anywhere with its keyboard shortcut.

Tots always run in full access, and they can approve requests in your other threads. Choose a model you trust with that.

## What a Tot does on its own

- Threads a Tot starts are normal threads you can open and steer. You are not notified about them; the Tot tells you what matters in its own thread.
- A Tot hears about the threads it started when they finish, fail, ask a question or need an approval. Ask it to watch other threads too.
- A Tot whose scope is all, such as Home, can create and turn on new Tots when you ask, here or on a linked environment. A new Tot cannot be given more scope than its creator has.
- Home can hand work to another Tot and hears back when that work ends.
- Tots never delete threads or projects. They archive or settle them.

**Watch reports**, in a Tot's panel on its own thread, chooses what it hears about: **Launched threads only** (the default) reports only threads the Tot started, **Every watch** also reports threads it asked to watch and runs it sent into another Tot's thread, and **Off** stops reports without deleting the watches, so turning them back on resumes them.

## Other machines

Tots live on one server and reach your other machines through linked environments. Turn on **Linked environments** in **Settings → Labs** on each machine, and link them at full access so a Tot can act and approve there.

## One thread each

A Tot is one conversation. Its project holds only its own thread, so Tots never appear when you pick a project for new work, and a new thread started from a Tot's thread goes to your usual project.

## Memory

Each Tot remembers in its own folder. `MEMORY.md` holds short lines about you, your machines and projects, your preferences, decisions and work in flight; longer notes go in a `memory` folder beside it. The Tot reads it when a new thread starts and keeps it up to date as it learns. Ask a Tot what it remembers, or tell it to forget something. Home can read every Tot's memory.

Open a Tot's memory from **Settings → Tots → Memory**, or right-click it in the sidebar. You can edit its files there. **Shared memory** shows what every Tot knows about you; it is read-only there.

## Moving a Tot

A Tot lives on one machine. To move it, open **Edit**, choose another machine under **Lives on**, and save. The Tot is made again on that machine with its memory; its thread starts fresh, and its model and any project scope are chosen again there. The original is removed once the new one is ready. Home moves too: the other machine's own Home takes its settings and memory, and the old Home is reset to its default and turned off.

## In the sidebar

Tots sit under the search bar. Each row shows what the Tot is doing (working, needs you, failed, off) and a filled dot when it has replied since you last looked. Right-click a Tot to open, edit, open its memory, start fresh, turn it off or delete it. The **Tots** button at the bottom opens Tots settings.

Click the section header to fold the list; its count stays visible while folded. Drag a Tot onto another Tot to reorder the section. The order is saved on that device rather than on the server, so each device can arrange the list differently, and rearranging never moves a Tot between machines. Group chats share the section and stay below the Tots.

Turn on **Tot toasts** in Appearance settings to get a toast when a Tot replies, needs you or fails while you are in another thread.

A Tot's replies are drawn in its color, with its face and name beside them.

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

## Faces

Pick a face's color, shape and skin when you create or edit a Tot. The antenna is off unless you turn it on for that Tot. The face catalog's accessories — today a top hat, glasses and a halo — are one click each; they can be worn together, each in its own color, and clicking one again takes it off. They show wherever the Tot's face is drawn, including its Discord avatar. When you edit a Tot that is on, type a few words under the face controls and press **Ask**: the Tot designs its own face, which becomes its face and joins a row of saved designs you can pick from later. Skins come in series, such as Jelly, Metal or Wood; pick a series to see its skins. On mobile you can change the color and shape; a skin or accessory set on desktop shows there too.

Faces move in a Tot's own thread, in the Tots tab, and when you hover them in the sidebar. To keep them still, turn off **Animate Tot avatars** in Appearance settings, on each device.

## Themes

A Tot can wear its own theme: pick one under **Theme** when you edit it. Projects have a **Theme** row in their settings, and **Appearance → Group themes** sets one per thread group. A thread uses its Tot's theme, else its project's, else its group's, else the app's own. These choices are kept on the device. Picking **Same as the app** (or **Same as the project**) removes one.

A Tot can also restyle its own conversation with CSS: open its **Theme** section in its settings, or ask it in its thread. The CSS is scoped to that Tot's conversation and applies only while its thread is open; the sidebar and other threads keep the app's theme. The **Effect** box beside it is stored for the effect layer and is not run by T3 Code.
