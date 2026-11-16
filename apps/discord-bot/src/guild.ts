// @effect-diagnostics nodeBuiltinImport:off - The webhook cache is one JSON file read with plain Node.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { TotAvatar } from "@t3tools/contracts";

import { isAllowedAuthor } from "./allowlist.ts";
import type { AvatarStore } from "./avatar.ts";
import { type Logger, describeError } from "./log.ts";

/** A Tot's channel name. Discord lowercases names, and a Tot id is already a slug. */
export const channelNameFor = (totId: string): string => `tot-${totId}`;

export interface ChannelTotMap {
  readonly map: ReadonlyMap<string, string>;
  readonly problems: ReadonlyArray<string>;
}

const CHANNEL_ID = /^\d+$/u;
const TOT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;

/** `channelId=totId` pairs, whitespace or comma separated. Pinned channels are never renamed. */
export const parseChannelTotMap = (value: string | undefined): ChannelTotMap => {
  const map = new Map<string, string>();
  const problems: Array<string> = [];
  const entries = (value ?? "")
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const [channelId, totId, extra] = entry.split("=");
    if (
      channelId === undefined ||
      totId === undefined ||
      extra !== undefined ||
      !CHANNEL_ID.test(channelId) ||
      !TOT_ID.test(totId)
    ) {
      problems.push(`CHANNEL_TOT_MAP entry ${entry} is not a channelId=totId pair.`);
      continue;
    }
    if (map.has(channelId)) {
      problems.push(`CHANNEL_TOT_MAP lists channel ${channelId} more than once.`);
      continue;
    }
    map.set(channelId, totId);
  }
  return { map, problems };
};

export interface GuildTot {
  readonly id: string;
  readonly name: string;
  readonly avatar: TotAvatar;
}

export interface GuildChannelView {
  readonly id: string;
  readonly name: string;
  /** A text channel the bot can write in; categories, voice and forums are not. */
  readonly textual: boolean;
}

export interface GuildWebhookView {
  readonly id: string;
  readonly name: string;
  /** Discord returns it only for webhooks this bot may post through. */
  readonly token: string | null;
}

/** What guild setup needs from Discord, so the setup itself runs without one. */
export interface GuildPort {
  readonly listChannels: () => Promise<ReadonlyArray<GuildChannelView>>;
  readonly createTextChannel: (name: string) => Promise<GuildChannelView>;
  readonly listWebhooks: (channelId: string) => Promise<ReadonlyArray<GuildWebhookView>>;
  readonly createWebhook: (
    channelId: string,
    input: { readonly name: string; readonly avatar: Buffer },
  ) => Promise<GuildWebhookView>;
  readonly editWebhook: (
    webhook: GuildWebhookView,
    input: { readonly name: string; readonly avatar: Buffer },
  ) => Promise<GuildWebhookView>;
}

export interface ChannelBindingPlan {
  readonly kind: "bind";
  readonly totId: string;
  readonly channelId: string;
  readonly via: "pin" | "name";
}

export interface ChannelCreatePlan {
  readonly kind: "create";
  readonly totId: string;
  readonly name: string;
}

export type ChannelSkipReason = "unknown-tot" | "unknown-channel" | "not-text" | "already-bound";

export interface ChannelSkipPlan {
  readonly kind: "skip";
  readonly totId: string;
  readonly channelId: string | null;
  readonly reason: ChannelSkipReason;
}

export type ChannelPlan = ChannelBindingPlan | ChannelCreatePlan | ChannelSkipPlan;

/**
 * One channel per Tot: pinned channels first, then a channel already named
 * `tot-<id>`, then a new one. An existing channel is only ever reused, never
 * renamed or deleted, and a pin wins over a name.
 */
export const planGuildChannels = (input: {
  readonly tots: ReadonlyArray<GuildTot>;
  readonly channels: ReadonlyArray<GuildChannelView>;
  readonly pinned: ReadonlyMap<string, string>;
}): ReadonlyArray<ChannelPlan> => {
  const totIds = new Set(input.tots.map((tot) => tot.id));
  const channelsById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const bound = new Set<string>();
  const claimed = new Set<string>();
  const plan: Array<ChannelPlan> = [];

  for (const [channelId, totId] of input.pinned) {
    if (!totIds.has(totId)) {
      plan.push({ kind: "skip", totId, channelId, reason: "unknown-tot" });
      continue;
    }
    const channel = channelsById.get(channelId);
    if (channel === undefined) {
      plan.push({ kind: "skip", totId, channelId, reason: "unknown-channel" });
      continue;
    }
    if (!channel.textual) {
      plan.push({ kind: "skip", totId, channelId, reason: "not-text" });
      continue;
    }
    if (bound.has(totId)) {
      plan.push({ kind: "skip", totId, channelId, reason: "already-bound" });
      continue;
    }
    bound.add(totId);
    claimed.add(channelId);
    plan.push({ kind: "bind", totId, channelId, via: "pin" });
  }

  for (const tot of input.tots) {
    if (bound.has(tot.id)) continue;
    const name = channelNameFor(tot.id);
    const existing = input.channels.find(
      (channel) => channel.textual && channel.name === name && !claimed.has(channel.id),
    );
    if (existing !== undefined) {
      bound.add(tot.id);
      claimed.add(existing.id);
      plan.push({ kind: "bind", totId: tot.id, channelId: existing.id, via: "name" });
      continue;
    }
    plan.push({ kind: "create", totId: tot.id, name });
  }

  return plan;
};

export interface WebhookIdentity {
  readonly webhookId: string;
  readonly avatarKey: string;
}

/** Which webhook and which face were last confirmed for a channel; a missing record only re-uploads. */
export interface WebhookState {
  readonly get: (channelId: string) => WebhookIdentity | undefined;
  readonly set: (channelId: string, identity: WebhookIdentity) => void;
  readonly save: () => void;
}

export const createWebhookState = (path: string): WebhookState => {
  let channels: Record<string, WebhookIdentity>;
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    channels =
      typeof parsed === "object" && parsed !== null
        ? { ...(parsed as Record<string, WebhookIdentity>) }
        : {};
  } catch {
    channels = {};
  }
  return {
    get: (channelId) => channels[channelId],
    set: (channelId, identity) => {
      channels[channelId] = identity;
    },
    save: () => {
      NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
      NodeFS.writeFileSync(path, `${JSON.stringify(channels, null, 2)}\n`);
    },
  };
};

export interface GuildChannelBinding {
  readonly channelId: string;
  readonly totId: string;
  readonly webhookId: string;
  readonly webhookToken: string;
}

const webhookFor = async (input: {
  readonly channelId: string;
  readonly tot: GuildTot;
  readonly port: GuildPort;
  readonly avatars: AvatarStore;
  readonly state: WebhookState;
}): Promise<{ webhook: GuildWebhookView; action: "created" | "updated" | "kept" }> => {
  const face = input.avatars.ensure(input.tot.id, input.tot.avatar);
  const recorded = input.state.get(input.channelId);
  const usable = (await input.port.listWebhooks(input.channelId)).filter(
    (webhook) => webhook.token !== null,
  );
  const existing = usable.find((webhook) => webhook.id === recorded?.webhookId) ?? usable[0];
  if (existing === undefined) {
    const webhook = await input.port.createWebhook(input.channelId, {
      name: input.tot.name,
      avatar: face.bytes,
    });
    input.state.set(input.channelId, { webhookId: webhook.id, avatarKey: face.key });
    return { webhook, action: "created" };
  }
  const unchanged =
    existing.name === input.tot.name &&
    recorded?.webhookId === existing.id &&
    recorded.avatarKey === face.key;
  if (unchanged) return { webhook: existing, action: "kept" };
  const webhook = await input.port.editWebhook(existing, {
    name: input.tot.name,
    avatar: face.bytes,
  });
  input.state.set(input.channelId, { webhookId: webhook.id, avatarKey: face.key });
  return { webhook, action: "updated" };
};

export interface GuildSetupOptions {
  readonly tots: ReadonlyArray<GuildTot>;
  readonly pinned: ReadonlyMap<string, string>;
  readonly port: GuildPort;
  readonly avatars: AvatarStore;
  readonly state: WebhookState;
  readonly logger: Logger;
}

/**
 * Creates or reuses one channel per Tot and one webhook per channel. A channel
 * that fails is logged and skipped, so a permission the bot lacks costs that
 * channel instead of every DM.
 */
export const ensureGuildChannels = async (
  options: GuildSetupOptions,
): Promise<ReadonlyArray<GuildChannelBinding>> => {
  const channels = await options.port.listChannels();
  const plan = planGuildChannels({
    tots: options.tots,
    channels,
    pinned: options.pinned,
  });
  const bindings: Array<GuildChannelBinding> = [];

  const bind = async (
    channelId: string,
    tot: GuildTot,
    via: "pin" | "name" | "created",
  ): Promise<GuildChannelBinding | null> => {
    const { webhook, action } = await webhookFor({
      channelId,
      tot,
      port: options.port,
      avatars: options.avatars,
      state: options.state,
    });
    if (webhook.token === null) {
      options.logger.warn("guild.webhook_unusable", { channelId, totId: tot.id });
      return null;
    }
    options.logger.info("guild.channel_ready", {
      channelId,
      totId: tot.id,
      via,
      webhook: action,
    });
    return { channelId, totId: tot.id, webhookId: webhook.id, webhookToken: webhook.token };
  };

  for (const entry of plan) {
    if (entry.kind === "skip") {
      options.logger.warn("guild.channel_skipped", {
        totId: entry.totId,
        ...(entry.channelId === null ? {} : { channelId: entry.channelId }),
        reason: entry.reason,
      });
      continue;
    }
    const tot = options.tots.find((candidate) => candidate.id === entry.totId);
    if (tot === undefined) continue;
    if (entry.kind === "bind") {
      try {
        const binding = await bind(entry.channelId, tot, entry.via);
        if (binding !== null) bindings.push(binding);
      } catch (cause) {
        options.logger.error("guild.channel_failed", {
          channelId: entry.channelId,
          totId: tot.id,
          reason: describeError(cause),
        });
      }
      continue;
    }
    let createdChannelId: string | null = null;
    try {
      const channel = await options.port.createTextChannel(entry.name);
      createdChannelId = channel.id;
      options.logger.info("guild.channel_created", {
        channelId: createdChannelId,
        totId: tot.id,
        name: channel.name,
      });
      const binding = await bind(createdChannelId, tot, "created");
      if (binding !== null) bindings.push(binding);
    } catch (cause) {
      options.logger.error("guild.channel_failed", {
        totId: tot.id,
        ...(createdChannelId === null ? {} : { channelId: createdChannelId }),
        reason: describeError(cause),
      });
    }
  }

  try {
    options.state.save();
  } catch (cause) {
    options.logger.warn("guild.webhook_state_failed", { reason: describeError(cause) });
  }
  return bindings;
};

export type GuildMessageDecision =
  | {
      readonly kind: "ignore";
      readonly reason: "unmapped" | "bot-author" | "not-allowed" | "empty";
    }
  | { readonly kind: "route"; readonly totId: string; readonly text: string };

/**
 * A channel message only reaches a Tot when the channel is mapped, the author
 * is allowlisted and not a bot, and the message has text. Anything else is
 * ignored, so the bridge never answers a channel on someone else's behalf.
 */
export const routeGuildMessage = (input: {
  readonly channelId: string;
  readonly author: { readonly userId: string | null | undefined; readonly bot: boolean };
  readonly content: string;
  readonly channelTots: ReadonlyMap<string, string>;
  readonly allowedUserIds: ReadonlySet<string>;
}): GuildMessageDecision => {
  const totId = input.channelTots.get(input.channelId);
  if (totId === undefined) return { kind: "ignore", reason: "unmapped" };
  if (input.author.bot) return { kind: "ignore", reason: "bot-author" };
  if (!isAllowedAuthor(input.author, input.allowedUserIds)) {
    return { kind: "ignore", reason: "not-allowed" };
  }
  const text = input.content.trim();
  if (text.length === 0) return { kind: "ignore", reason: "empty" };
  return { kind: "route", totId, text };
};
