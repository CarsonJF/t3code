# External Companion Protocol v1

A companion is an agent service you run yourself, such as an assistant that also answers on chat or voice. T3 Code shows each registered companion in its own sidebar section, lets you chat with it and its children, and puts what it asks you in **Needs you**. This page is the contract a companion implements. To connect one, see [External Companions](./external-companions.md).

The T3 Code server is the only client. It sends the token you saved in Settings as `Authorization: Bearer <token>` on every request and on the WebSocket handshake. Browsers and phones never talk to the companion and never see the token.

## Conventions

- JSON in UTF-8. Unknown fields are ignored, so you can add your own.
- Times are ISO 8601 strings, such as `2026-11-25T12:00:00.000Z`.
- Ids (`id`, `messageId`, child ids, tool call ids, needs-you ids) use only `A–Z a–z 0–9 . _ : -`, 1 to 128 characters.
- A channel is `main` for the companion itself, or `child:<id>` for one of its children.
- Message text is Markdown. T3 Code renders it with raw HTML escaped and treats everything the companion sends as untrusted.
- A non-2xx answer is reported by status code only; the response body is never shown to the user.

## Manifest

`GET /companion/v1/manifest`

```json
{
  "protocol": "companion.v1",
  "id": "my-companion",
  "name": "My Companion",
  "tagline": "Keeps an eye on things",
  "avatar": {
    "style": "open-bot",
    "figure": "rocket",
    "color": "#0ea5e9",
    "material": "soft",
    "mood": "happy"
  },
  "capabilities": { "streaming": true, "needsYou": true, "linkedThreads": true, "children": true },
  "childrenLabel": "Helpers",
  "children": [
    {
      "id": "scout",
      "name": "Scout",
      "role": "Looks things up",
      "avatar": { "figure": "cat" },
      "unreadCount": 2
    }
  ]
}
```

`protocol` must be exactly `companion.v1`. `avatar` is an [open-bot-avatar](../../packages/open-bot-avatar/README.md) look: `figure` is a built-in figure id, `color` a `#rrggbb` color, `material` one of `flat`, `fluffy`, `glass` or `soft`, and `mood` `neutral` or `happy`. Any part that is missing or malformed falls back to a default figure and color. `childrenLabel` names the children's dropdown in the sidebar.

## History

`GET /companion/v1/channels/{channel}/history?limit=50&before=<cursor>`

```json
{
  "messages": [
    {
      "id": "m-41",
      "role": "assistant",
      "createdAt": "2026-11-25T12:00:00.000Z",
      "sourceSurface": "voice",
      "text": "Done. I opened a thread for the fix.",
      "toolCalls": [{ "id": "t-1", "name": "search", "status": "done", "summary": "3 results" }],
      "linkedThreads": [
        {
          "threadId": "thread-abc",
          "title": "Fix the flaky test",
          "status": "running",
          "link": "t3-thread://v2/<environmentId>/thread-abc"
        }
      ],
      "needsYou": [
        { "id": "n-7", "kind": "approval", "prompt": "Deploy now?", "status": "pending" }
      ]
    }
  ],
  "nextCursor": "m-40"
}
```

Messages come oldest first. `limit` is at most 100 (T3 Code asks for 50). `nextCursor` is passed back as `before` to read the page before this one; it is `null` or absent at the start of the channel.

- `role`: `user`, `assistant` or `system`.
- `sourceSurface`: where the message was written, such as `t3`, `discord` or `voice`. Shown as a badge.
- `toolCalls[].status`: `running`, `done` or `error`; other values show as given.
- `linkedThreads[]`: T3 Code threads the message is about. `link` is a T3 thread link, as `t3_thread_launch` and Copy thread produce; without one, `threadId` is looked up on the server the companion is registered with. A thread on a machine that server is linked to opens through that server.
- `needsYou[]`: things the user must answer. `kind` is `question` or `approval`; `options` offers answers for a question; `status` is `pending` until answered; `resolution` may be a string or `{ "decision", "answer" }`.

## Sending a message

`POST /companion/v1/channels/{channel}/messages`

```json
{ "text": "What changed today?", "clientMessageId": "6f1c…", "source": "t3" }
```

Answer `202` with `{ "messageId": "…" }`. A retry after a failure sends the same `clientMessageId`; drop a duplicate rather than posting it twice. The message itself arrives through the events socket (`message.created`), like every other message.

## Answering a needs-you item

`POST /companion/v1/needs-you/{id}/respond`

```json
{ "decision": "accept", "answer": "the second one" }
```

`decision` is `accept` or `decline`. `answer` carries the chosen option or the typed text for a question. Confirm with a `needs_you.resolved` event.

## Events

`GET /companion/v1/events` upgraded to a WebSocket. Each text frame is one JSON object with a `type`. Frames that are not valid JSON, or not one of these shapes, are ignored.

| `type`               | Fields                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `message.created`    | `channel`, `message` (a full message, `text` may start empty)                             |
| `message.delta`      | `channel`, `messageId`, `delta`: text appended to the message                             |
| `message.done`       | `channel`, `messageId`, optional `message`: the final message, replacing the streamed one |
| `tool.state`         | `channel`, `messageId`, `toolCall`: added or replaced by its `id`                         |
| `thread.linked`      | `channel`, `messageId`, `linkedThread`: added or replaced by its `threadId`               |
| `needs_you.created`  | `channel`, optional `messageId`, `needsYou`                                               |
| `needs_you.resolved` | `needsYouId`, optional `channel` and `resolution`                                         |
| `avatar.state`       | `state` (`idle`, `working`, `waiting`, `done`, `blocked` or `sleep`), optional `childId`  |
| `child.updated`      | `child`: added or replaced by its `id`, including `unreadCount`                           |

When the socket drops, T3 Code reconnects with backoff (1 second, doubling to a minute) and reads the manifest and every channel's newest history page again, so events missed while away are recovered from history. Keep history as the source of truth.

## Themes

A companion cannot style its own conversation: T3 ignores any CSS or script in its manifest or events. The person running T3 sets a theme in Settings → External Companions, or an agent does it with `t3_companion_theme_set`. It works like a Tot's theme, scoped to `[data-companion-id="<id>"]`, and child channels share it; their view also carries `data-companion-channel="child:<id>"` for rules that should apply to one child. A Tot theme's `css` and `effect` work unchanged, so a Tot theme export's `theme` object can be passed straight to `t3_companion_theme_set`.

## MCP access back into T3 Code

A companion can also call T3 Code's own MCP server, for example to start threads. See [MCP access for a companion](./external-companions.md#mcp-access-for-a-companion).
