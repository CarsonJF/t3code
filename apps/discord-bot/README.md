# Discord Tot bridge

A service that lets an allowlisted Discord user talk to a
[Tot](../../docs/internals/tots.md) from direct messages, or from one text
channel per Tot in a server, in the same thread the app shows. One bridge can
serve Tots from several T3 machines at once. It is separate from the desktop app
and only runs when started.

- Runbook, including the Discord application setup, several machines, and token
  rotation: [docs/discord-tot-bridge.md](../../docs/discord-tot-bridge.md)
- Code: `src/main.ts` is the entry point; `src/discord.ts` is the only runtime
  file that imports discord.js, and everything behind it talks to `ChannelPort`.
  `src/environments.ts` owns one MCP client per machine.
- Try it without Discord: `npm run dry-run`.

```sh
cp .env.example .env    # DISCORD_TOKEN, DISCORD_ALLOWED_USER_IDS, and T3_MCP_URL + T3_MCP_TOKEN or T3_ENVIRONMENTS
npm run mint-token      # once per machine, with a pairing code from `t3 auth pairing create`
npm run dry-run
npm start
```

Guild mode is opt-in with `DISCORD_GUILD_ID`: one text channel per Tot, each
with its own webhook wearing the Tot's name and face. `CHANNEL_TOT_MAP` pins
channels that already exist (`channelId=totId`, or `channelId=label:totId` when
several machines are configured), and `DISCORD_AVATAR_DIR` moves the face cache.
The runbook covers the intent and permissions it needs.

Several machines are one JSON array, `T3_ENVIRONMENTS`, with a `label`, `mcpUrl`
and `token` per machine. Set it instead of `T3_MCP_URL` and `T3_MCP_TOKEN`, never
both. `/tot list` groups by machine, and two machines with the same Tot id get
`tot-<label>-<id>` channels.

Logs go to `discord-tot-bridge.log` (JSON lines, no message text, no secrets).
`environment.ready` and `environment.failed` report each machine's health;
one machine being down does not stop the others.
