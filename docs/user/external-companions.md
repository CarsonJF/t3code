# External Companions

An External Companion is an agent service you run outside T3 Code that speaks [External Companion Protocol v1](./external-companion-protocol.md). Once registered, it gets its own **External Companions** section in the sidebar, apart from Tots, with its children as a dropdown under it. Chat with it there, see its tool calls and the threads it started, and answer what it asks, either inline or from **Needs you**.

## Add a companion

1. Open **Settings → External Companions** and pick the environment that should talk to it.
2. Select **Add companion**, enter its base URL (for example `http://127.0.0.1:4790`) and its bearer token, or pick the token from a [secret provider](./secrets.md).
3. Select **Test connection**. T3 Code reads `/companion/v1/manifest` and shows the companion's name and face. Save.

The token is kept in the server's secret store, never in `settings.json`. Only the server talks to the companion, so the token never reaches your browser, the desktop app or your phone, even over a remote connection. Changing a saved companion's URL to another origin clears its token; enter it again.

While a companion is offline, its face sleeps and its row says so. T3 Code keeps reconnecting and catches up on what it missed when the companion is back.

## Chat

Select the companion, or one of its children, in the sidebar. Messages from every surface the companion listens on show up here with a badge for where they were written, such as `discord` or `voice`. Replies stream in. Tool calls show as compact cards that update as they run, and threads the companion started open with a click, on this machine or a linked one. **Load older messages** pages back through history.

Answer a question or approval in the chat, or from **Needs you**, where each companion has its own section. Dismissing or snoozing an item there hides it only in T3 Code; the companion still waits for an answer.

## MCP access for a companion

A companion that calls T3 Code's MCP server (`/mcp`), for example to launch threads, can use a grant tied to its registration instead of an MCP sign-in that expires after 30 days.

1. In **Settings → External Companions**, select **MCP grant** on the companion, choose its access level, and select **Issue setup code**.
2. Give the companion the setup code. It is shown once and works once, within 10 minutes.
3. The companion exchanges it at the token endpoint shown with the code, from the same machine as the T3 Code server:

   ```bash
   curl -s http://127.0.0.1:3773/api/companions/v1/token \
     -H 'content-type: application/json' \
     -d '{"grant_type":"setup_code","code":"t3cs_…"}'
   ```

   The answer holds an `access_token` for `/mcp` (send it as `Authorization: Bearer …`), its `expires_in` (one hour), and a `refresh_token`.

4. Before the access token expires, the companion trades the refresh token for a new pair:

   ```bash
   curl -s http://127.0.0.1:3773/api/companions/v1/token \
     -H 'content-type: application/json' \
     -d '{"grant_type":"refresh_token","refresh_token":"t3cr_…"}'
   ```

   Each refresh token works once and is replaced by the new one; store the newest. A refresh token unused for 30 days lapses, and then the companion needs a new setup code. Presenting a refresh token that was already used ends the grant, since that means someone else holds a copy.

The grant and its tokens are accepted only from the machine T3 Code runs on: from loopback or this machine's own address, straight to the server, never through Tailscale Serve, a tunnel or another proxy. A companion in a container needs host networking. The access level is one an outside MCP client could be approved for, capped by a [managed policy](./managed-policy.md) if one applies. What the companion sends through `/mcp` is recorded as coming from that companion, by its id in Settings, so a Tot's [Who can ask](./tots.md#who-can-ask) list can name it.

Select **Revoke MCP** to end the grant at once. Removing the companion ends it too.
