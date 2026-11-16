# Discord Tot bridge

A small service that lets you talk to a [Tot](./internals/tots.md) from Discord
direct DMs, or from a text channel of its own in one server, in the same thread
the app shows. It posts your message through the environment's MCP endpoint,
follows the turn, edits one message as the answer streams in, and answers
questions the Tot asks.

It is a separate process (`apps/discord-bot`), not part of the desktop app.
Nothing in the app changes when it is off.

## What it does

- **Plain DMs go to your current Tot.** The first time, that is Home. `/tot use
  <name>` makes another Tot sticky for your Discord user id; the app and other
  people are unaffected.
- **In a server, each Tot can have a channel.** With `DISCORD_GUILD_ID` set, the
  bridge makes a `tot-<id>` channel for every Tot and posts there through a
  webhook wearing the Tot's name and face. See [One channel per
  Tot](#one-channel-per-tot).
- **The turn is a normal T3 turn.** Same provider, model, tools, and permission
  mode as the Tot's thread in the app, because it is that thread. You can watch
  it in the app and keep the conversation there.
- **The reply streams.** One message starts as "Home is working…", picks up the
  current tool while there is no text yet, then edits with the answer about once
  a second. Past 1,900 characters the rest arrives as further messages, and
  fenced code blocks are never cut in half.
- **Questions come to the DM.** When the Tot asks something, the options are
  posted numbered. Reply with a number, `1,3` for a multiple-choice question, or
  type your own answer. Replies are collected and sent in one answer, the way
  the app does.
- **`/tot stop`, or the shorter `/stop`, is the app's Stop.** It interrupts the
  running turn and holds the queued messages.
- **`/tot new` starts a fresh session.** The next message opens a new provider
  context in the Tot's thread, like `/clear`. T3's **Start fresh**, which moves
  the Tot to a new thread, is only in the app.
- **One turn at a time per Tot.** A second DM while it works is told so, instead
  of queueing silently behind the first.

### What it cannot do

- **Approve a permission request.** Approvals can only be answered by a Tot,
  and this bridge is an outside MCP client, not a Tot. When a turn asks for
  approval, the DM or channel shows the prompt and a thread link, and the turn
  waits until you approve in the app. `/tot stop` is the way to decline.
- **Forward attachments.** Text only for now.
- **Start a Tot that is off.** Turn it on in the app first; the DM says so.
- **Read a thread inside a Tot channel.** Threads are not mapped; only the
  channel itself is.
- **Reach a linked machine's Tots on its own.** The bridge acts on the
  environment its token belongs to.

## Set it up

### 1. Create the Discord application

1. Open <https://discord.com/developers/applications> and choose **New
   Application**. Name it something you will recognize in your DM list.
2. On **Bot**, choose **Reset Token** and keep the value. That is
   `DISCORD_TOKEN`. Do not paste it into chat or commit it.
3. In **Bot → Privileged Gateway Intents**, leave **Message Content Intent** off
   for DMs alone: Discord delivers DM text without it. Turn it on, and save,
   before you set `DISCORD_GUILD_ID`: a server delivers channel text only with
   it, and the bot asks for it as soon as guild mode is on. The other privileged
   intents stay off.
4. On **Installation**, turn on **User Install** if you want to add the app to
   your own account. This also makes `/tot` usable in a DM when you do not share
   a server with the bot. With only **Guild Install**, invite it to a server and
   DM it from there.

### 2. Invite the bot and open a DM

Use the **Install Link** on the **Installation** page, or build one:

```text
https://discord.com/api/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=0
```

`applications.commands` is what registers `/tot`; without it the bot works but
the slash command never appears. `permissions=0` is deliberate for DMs: they
need no server permissions. Guild mode needs View Channels, Send Messages, Read
Message History, Manage Webhooks and Manage Channels; [One channel per
Tot](#one-channel-per-tot) lists them and the invite `permissions=536937536`
that carries exactly those.

Open a DM with the bot and send it a message. Nothing happens yet: the service
is not running and your id is not allowlisted.

### 3. Get your Discord user id

In Discord, **Settings → Advanced → Developer Mode** on, then right-click your
name and **Copy User ID**. That number goes in `DISCORD_ALLOWED_USER_IDS`.

### 4. Mint a T3 token

The bridge signs in to the environment's MCP endpoint the same way any outside
agent does: once, with a pairing code, for a 30-day client session. On the
machine that runs the T3 server:

```sh
t3 auth pairing create --json
```

That prints a `credential` and expires in five minutes. Then, in the bridge
directory:

```sh
npm run mint-token
```

It asks for the pairing code (paste the `credential`, or the whole JSON line, or
the `/pair#token=...` link), approves a **full access** client, and prints
`T3_MCP_TOKEN=...` once. Keep it in `.env`; it is not shown again.

Full access is required: Tot threads run in `full-access`, and a client may not
act on a thread with broader modes than itself.

Instead of `t3 auth pairing create`, the app's **Use T3 Code in another app
(MCP)** dialog issues the same kind of code, and either code works in
`npm run mint-token`.

### 5. Configure and run

```sh
cd apps/discord-bot
cp .env.example .env
$EDITOR .env          # DISCORD_TOKEN, DISCORD_ALLOWED_USER_IDS, T3_MCP_URL, T3_MCP_TOKEN
npm run dry-run       # optional: type DMs on stdin, nothing reaches Discord
npm start
```

`.env`:

```sh
DISCORD_TOKEN=...
DISCORD_ALLOWED_USER_IDS=123456789012345678
T3_MCP_URL=http://127.0.0.1:3773/mcp
T3_MCP_TOKEN=...

# Optional: one channel per Tot in this server. See "One channel per Tot".
DISCORD_GUILD_ID=
# Optional: keep channels that already exist, as channelId=totId pairs.
CHANNEL_TOT_MAP=
# Optional: where Tot faces are cached. Default .webhook-avatars.
DISCORD_AVATAR_DIR=
```

Guild mode is off while `DISCORD_GUILD_ID` is empty, and everything below works
without it.

`T3_MCP_URL` is the environment's `/mcp` address: the port the server listens
on, or its T3 Connect or Tailscale HTTPS address if the bridge runs elsewhere.
The bridge needs no inbound port.

`npm run dry-run` reads lines from stdin and prints every message it would send
or edit, while still talking to the real T3 server. It needs `T3_MCP_URL` and
`T3_MCP_TOKEN` only, so routing, streaming, and questions can be exercised
without a bot token. `/tot list`, `/tot use <name>`, `/tot new`, and `/tot stop`
work there too.

Logs go to `discord-tot-bridge.log` in the working directory, one JSON line per
event: user id, channel id, Tot id, thread id, tool names, outcomes. Message
text and credentials are never written. Guild setup logs `guild.channel_ready`,
`guild.channel_skipped` and `guild.channel_failed` per channel. Set
`DISCORD_BOT_LOG_FILE` to move the file.

### 6. Keep it running with systemd

[discord-tot-bridge.service](../apps/discord-bot/discord-tot-bridge.service) is
a starting point:

```sh
sudo install -m 600 .env /etc/t3code-discord-bot.env
sudo cp apps/discord-bot/discord-tot-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now discord-tot-bridge
journalctl -u discord-tot-bridge -f
```

Adjust `User`, `WorkingDirectory`, and the `node` path for the host. The unit
restarts on failure; the bridge itself retries a Discord login with backoff and
stops on a rejected token, so a bad token shows up in the journal instead of
looping.

## Using it

| In the DM                                         | What happens                                              |
| ------------------------------------------------- | --------------------------------------------------------- |
| any text                                          | Sent to the current Tot                                   |
| `/tot list`                                       | Tots here, which one this DM reaches, which are off       |
| `/tot use <name>`                                 | Makes that Tot the current one; autocomplete offers names |
| `/tot new`                                        | The next message starts a fresh session in that thread    |
| `/tot stop` or `/stop`                            | Interrupts the turn and holds queued messages             |
| a number, `1,3`, or text while a question is open | Answers the Tot's question                                |

Slash commands are registered globally the first time the bridge connects.
Discord can take up to an hour to show them in a DM; plain messages work
immediately.

## One channel per Tot

Guild mode gives every Tot a text channel of its own in one server, so a room
can talk to a Tot without a DM per person. It is opt-in: while
`DISCORD_GUILD_ID` is empty, nothing here happens and DMs are the whole bridge.

### Set it up once

1. **Turn on Message Content.** Discord application → **Bot → Privileged Gateway
   Intents → Message Content Intent** → save. A server delivers channel text
   only with this intent, and the bridge asks for it only when guild mode is on.
2. **Give the bot its permissions in the server.** Either invite it with
   `permissions=536937536`, which is exactly this set, or grant them on the
   bot's role:
   - View Channels
   - Send Messages
   - Read Message History
   - Manage Webhooks
   - Manage Channels

   Manage Channels and Manage Webhooks are what create the channels and their
   webhooks; the others are what let the Tot talk in them.

3. **Set the server id** in `.env` and restart:

   ```sh
   DISCORD_GUILD_ID=123456789012345678
   ```

   With Developer Mode on, right-click the server and **Copy Server ID**.

### What it creates

For every Tot on this environment, on every start:

- **A text channel named `tot-<totId>`**, such as `tot-home` or `tot-t3bot`. A
  channel with that name is reused; one is created only when none has it.
- **One webhook in that channel**, named after the Tot, with the Tot's face as
  its avatar: a 128×128 PNG drawn from the Tot's colour and two-eye face, cached
  in `.webhook-avatars/<environment>/<totId>.png`. Set `DISCORD_AVATAR_DIR` to
  cache elsewhere, for example when the service's working directory is
  read-only.

Replies are posted through that webhook, so they carry the Tot's name and face
rather than the bot's. The placeholder ("Home is working…"), its streaming edits
and the settled answer are one webhook message, and further messages past 1,900
characters are webhook messages too. Questions and approvals show the same way
they do in a DM, and any allowlisted person in the channel can answer a
question. `/stop` or `/tot stop` in the channel interrupts that Tot. `/tot
list`, `/tot use` and `/tot new` stay in DMs, because a channel's Tot is fixed.
Messages in threads under a Tot channel, and in any channel it did not map, are
ignored.

Setup is idempotent and never renames or deletes a channel. A second start makes
no Discord calls unless a Tot's name or face changed, and then it only edits
that Tot's webhook. A channel that cannot be created or reached is logged and
skipped; every other channel, and all DMs, keep working.

### Channels that already exist

`CHANNEL_TOT_MAP` pins a channel id to a Tot, so a channel can keep the name and
place you gave it:

```sh
CHANNEL_TOT_MAP=123456789012345678=home,234567890123456789=t3bot
```

A pin wins over the `tot-<id>` name. Pins are checked at every start: a channel
or Tot that no longer exists is logged and skipped, and that Tot gets a
`tot-<id>` channel instead. With Developer Mode on, right-click a channel and
**Copy Channel ID**.

### If you rename a channel

The bridge never renames a channel, and it does not follow a rename on its own.
It remembers which channel id holds which Tot while it runs, so a rename keeps
working until the next restart. After that, no channel is named `tot-<id>`, so a
fresh channel with the default name appears and the renamed one is left alone.
To keep the renamed channel, pin it with `CHANNEL_TOT_MAP` before restarting.

### Privacy: the reply looks like a person

A webhook message is an ordinary channel message with someone else's name and
picture on it. Everyone who can read the channel reads it as the Tot, and it
stays in the channel's history like any other message. Anything the Tot says
there is visible to everyone in the channel, not just the person who asked.
Treat a mapped channel as a room: the Tot has full access to the machine, and
everyone in that room sees what it says.

## Security model

- **Allowlisted ids only, in DMs and in channels.** Every path (messages,
  channel messages, commands, autocomplete) checks `DISCORD_ALLOWED_USER_IDS`
  before doing anything, and everyone else is ignored. A channel message from
  anyone else never reaches a Tot, and no webhook message is created for it. An
  empty allowlist refuses to start.
- **A DM or channel is a full agent on the host.** The Tot's thread runs in
  `full-access` with the same tools as the app: it can read and write files, run
  commands, and reach the projects in its scope. Anyone who controls an
  allowlisted Discord account controls that. Treat it like a terminal on the
  machine, and do not allowlist an account you would not hand a shell.
- **Discord can read bot DMs.** Discord's own servers carry the messages, so
  nothing secret belongs in a DM prompt. The bridge keeps message text out of
  its logs, but it cannot make Discord private.
- **The token is a credential for this machine.** It is a 30-day MCP client
  session with full access. It lives in `.env` (mode 600) and is redacted from
  logs. It is scoped to `/mcp`; it cannot call the WebSocket RPC or other HTTP
  routes.
- **The pairing code is single use.** It expires in five minutes, and the
  exchange happens locally, so no browser or callback port is involved.

## Rotating the token

A token expires after 30 days, and you can cut it off early:

1. In the app, **Settings → Sharing and access**, find the client named
   `Discord Tot bridge` and revoke it. The old token stops working at once.
2. `t3 auth pairing create --json`, then `npm run mint-token`, as above.
3. Put the new value in `.env` (or `/etc/t3code-discord-bot.env`) and
   `sudo systemctl restart discord-tot-bridge`.

An HTTP 401 or 403 from T3 in the log means the token is gone; the bridge tells
the DM so.

## Troubleshooting

| Symptom                                  | Check                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The bot ignores you                      | Your id in `DISCORD_ALLOWED_USER_IDS`, no spaces or quotes. The log records `discord.ignored_author`. |
| No reply and no log line                 | The DM did not reach the bot. Friend the bot or invite it to a server you are in.                     |
| `/tot` is not in the DM list             | `applications.commands` in the invite, then wait up to an hour.                                       |
| Nothing happens in a Tot channel         | `DISCORD_GUILD_ID`, the channel in `guild.channel_ready` in the log, and your id allowlisted.         |
| No `tot-<id>` channels appeared          | Manage Channels and Manage Webhooks. `guild.channel_failed` names the channel and the error.          |
| Channel messages arrive empty            | Message Content Intent is on in the Bot tab, then restart the bridge.                                 |
| A second `tot-home` after a rename       | The bridge does not follow renames. Pin the renamed channel in `CHANNEL_TOT_MAP`.                     |
| "The T3 MCP endpoint rejected the token" | Mint a new token; it expired or was revoked.                                                          |
| "Home is not running"                    | Turn the Tot on in the app; a Tot has a thread only while it is on.                                   |
| "Could not reach the T3 MCP endpoint"    | `T3_MCP_URL`, and whether the server is running.                                                      |
| Approvals never answer                   | By design: approve in the app, or `/tot stop`.                                                        |
