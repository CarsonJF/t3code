# Discord Tot bridge

A small service that lets you talk to a [Tot](./internals/tots.md) from Discord
direct DMs, in the same thread the app shows. It posts your message through the
environment's MCP endpoint, follows the turn, edits one message as the answer
streams in, and answers questions the Tot asks.

It is a separate process (`apps/discord-bot`), not part of the desktop app.
Nothing in the app changes when it is off.

## What it does

- **Plain DMs go to your current Tot.** The first time, that is Home. `/tot use
  <name>` makes another Tot sticky for your Discord user id; the app and other
  people are unaffected.
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
  approval, the DM shows the prompt and a thread link, and the turn waits until
  you approve in the app. `/tot stop` is the way to decline.
- **Forward attachments.** Text only for now.
- **Start a Tot that is off.** Turn it on in the app first; the DM says so.
- **Reach a linked machine's Tots on its own.** The bridge acts on the
  environment its token belongs to.

## Set it up

### 1. Create the Discord application

1. Open <https://discord.com/developers/applications> and choose **New
   Application**. Name it something you will recognize in your DM list.
2. On **Bot**, choose **Reset Token** and keep the value. That is
   `DISCORD_TOKEN`. Do not paste it into chat or commit it.
3. Leave **Message Content Intent** and the other privileged intents off. The
   bridge only reads DMs, and Discord delivers DM text without that intent.
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
the slash command never appears. `permissions=0` is deliberate: the bridge needs
no server permissions, because it only writes in DMs.

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
```

`T3_MCP_URL` is the environment's `/mcp` address: the port the server listens
on, or its T3 Connect or Tailscale HTTPS address if the bridge runs elsewhere.
The bridge needs no inbound port.

`npm run dry-run` reads lines from stdin and prints every message it would send
or edit, while still talking to the real T3 server. It needs `T3_MCP_URL` and
`T3_MCP_TOKEN` only, so routing, streaming, and questions can be exercised
without a bot token. `/tot list`, `/tot use <name>`, `/tot new`, and `/tot stop`
work there too.

Logs go to `discord-tot-bridge.log` in the working directory, one JSON line per
event: user id, Tot id, thread id, tool names, outcomes. Message text and
credentials are never written. Set `DISCORD_BOT_LOG_FILE` to move the file.

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

## Security model

- **DMs from allowlisted ids only.** Every path (messages, commands,
  autocomplete) checks `DISCORD_ALLOWED_USER_IDS` before doing anything, and
  everyone else is ignored. An empty allowlist refuses to start.
- **A DM is a full agent on the host.** The Tot's thread runs in `full-access`
  with the same tools as the app: it can read and write files, run commands, and
  reach the projects in its scope. Anyone who controls an allowlisted Discord
  account controls that. Treat a DM like a terminal on the machine, and do not
  allowlist an account you would not hand a shell.
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
| "The T3 MCP endpoint rejected the token" | Mint a new token; it expired or was revoked.                                                          |
| "Home is not running"                    | Turn the Tot on in the app; a Tot has a thread only while it is on.                                   |
| "Could not reach the T3 MCP endpoint"    | `T3_MCP_URL`, and whether the server is running.                                                      |
| Approvals never answer                   | By design: approve in the app, or `/tot stop`.                                                        |
