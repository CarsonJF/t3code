import type { GuildChannelView, GuildPort, GuildWebhookView, WebhookState } from "./guild.ts";
import { avatarSpecKey, type AvatarStore } from "./avatar.ts";

export interface FakeGuild {
  readonly port: GuildPort;
  readonly channels: Array<GuildChannelView>;
  /** Every create and edit, in order, so a second run can assert it made none. */
  readonly calls: Array<string>;
  readonly webhooksIn: (channelId: string) => ReadonlyArray<GuildWebhookView>;
  readonly addChannel: (channel: GuildChannelView) => void;
  readonly addWebhook: (channelId: string, webhook: GuildWebhookView) => void;
}

/** A server in memory: creating a channel or webhook is recorded, never renamed. */
export const createFakeGuild = (
  initialChannels: ReadonlyArray<GuildChannelView> = [],
): FakeGuild => {
  const channels = [...initialChannels];
  const webhooks = new Map<string, GuildWebhookView[]>();
  const calls: Array<string> = [];
  let nextChannel = 1000;
  let nextWebhook = 0;

  const webhooksIn = (channelId: string): Array<GuildWebhookView> => {
    const existing = webhooks.get(channelId);
    if (existing !== undefined) return existing;
    const created: Array<GuildWebhookView> = [];
    webhooks.set(channelId, created);
    return created;
  };

  return {
    channels,
    calls,
    webhooksIn,
    addChannel: (channel) => {
      channels.push(channel);
    },
    addWebhook: (channelId, webhook) => {
      webhooksIn(channelId).push(webhook);
    },
    port: {
      listChannels: async () => [...channels],
      createTextChannel: async (name) => {
        nextChannel += 1;
        const channel = { id: String(nextChannel), name, textual: true };
        channels.push(channel);
        calls.push(`createChannel:${name}`);
        return channel;
      },
      listWebhooks: async (channelId) => [...webhooksIn(channelId)],
      createWebhook: async (channelId, input) => {
        nextWebhook += 1;
        const webhook = {
          id: `webhook-${nextWebhook}`,
          name: input.name,
          token: `webhook-token-${nextWebhook}`,
        };
        webhooksIn(channelId).push(webhook);
        calls.push(`createWebhook:${channelId}`);
        return webhook;
      },
      editWebhook: async (webhook, input) => {
        const edited = { ...webhook, name: input.name };
        for (const [channelId, hooks] of webhooks) {
          const index = hooks.findIndex((candidate) => candidate.id === webhook.id);
          if (index === -1) continue;
          hooks[index] = edited;
          calls.push(`editWebhook:${channelId}`);
          return edited;
        }
        throw new Error(`The fake guild has no webhook ${webhook.id}.`);
      },
    },
  };
};

/** Faces without a disk: the bytes change with the spec, so a test can see an upload. */
export const createFakeAvatars = (): {
  readonly store: AvatarStore;
  readonly renders: () => number;
} => {
  let renders = 0;
  return {
    renders: () => renders,
    store: {
      ensure: (totId, avatar) => {
        renders += 1;
        const key = avatarSpecKey(avatar);
        return { bytes: Buffer.from(`${totId}:${key}`), key, path: `/faces/${totId}.png` };
      },
    },
  };
};

export const createFakeWebhookState = (): WebhookState & {
  readonly records: ReadonlyMap<string, { webhookId: string; avatarKey: string }>;
} => {
  const records = new Map<string, { webhookId: string; avatarKey: string }>();
  return {
    records,
    get: (channelId) => records.get(channelId),
    set: (channelId, identity) => {
      records.set(channelId, identity);
    },
    save: () => undefined,
  };
};
