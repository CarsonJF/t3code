# Discord Tot bridge

A service that lets an allowlisted Discord user talk to a
[Tot](../../docs/internals/tots.md) from direct messages, or from one text
channel per Tot in a server, in the same thread the app shows. It is separate
from the desktop app and only runs when started.

- Runbook, including the Discord application setup and token rotation:
  [docs/discord-tot-bridge.md](../../docs/discord-tot-bridge.md)
- Code: `src/main.ts` is the entry point; `src/discord.ts` is the only file that
  imports discord.js, and everything behind it talks to `ChannelPort`.
- Try it without Discord: `npm run dry-run`.

```sh
cp .env.example .env    # DISCORD_TOKEN, DISCORD_ALLOWED_USER_IDS, T3_MCP_URL, T3_MCP_TOKEN
npm run mint-token      # once, with a pairing code from `t3 auth pairing create`
npm run dry-run
npm start
```

Guild mode is opt-in with `DISCORD_GUILD_ID`: one text channel per Tot, each
with its own webhook wearing the Tot's name and face. `CHANNEL_TOT_MAP` pins
channels that already exist (`channelId=totId`), and `DISCORD_AVATAR_DIR` moves
the face cache. The runbook covers the intent and permissions it needs.

Logs go to `discord-tot-bridge.log` (JSON lines, no message text, no secrets).
