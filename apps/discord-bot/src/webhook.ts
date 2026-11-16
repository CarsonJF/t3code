import type { ChannelPort } from "./turns.ts";

/** What a Tot's webhook can do in its channel, without discord.js in the way. */
export interface WebhookMessageApi {
  readonly send: (content: string) => Promise<{ readonly id: string }>;
  readonly edit: (messageId: string, content: string) => Promise<void>;
}

/**
 * A Tot's channel: every reply is a webhook message, so it carries the Tot's
 * own name and face. The placeholder, its streaming edits and the settled
 * answer all go through the same message id.
 */
export const createWebhookChannelPort = (api: WebhookMessageApi): ChannelPort => ({
  send: (text) => api.send(text),
  edit: (message, text) => api.edit(message.id, text),
  // Discord shows no typing indicator for webhooks.
  typing: async () => undefined,
});
