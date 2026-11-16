// @effect-diagnostics nodeBuiltinImport:off - The webhook cache is one JSON file read with plain Node.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { TotAvatar } from "@t3tools/contracts";

import { isAllowedAuthor } from "./allowlist.ts";
import type { AvatarStore } from "./avatar.ts";
import { type Logger, describeError } from "./log.ts";
import type { TotRef } from "./routing.ts";

/** A Tot's channel name. Discord lowercases names, and a Tot id is already a slug. */
export const channelNameFor = (totId: string): string => `tot-${totId}`;

/** The machine part of a channel name, so two machines can share a Tot id. */
export const labelSlug = (label: string): string => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length === 0 ? "machine" : slug;
};

/**
 * A Tot's channel: `tot-<id>` while that id is unique across machines, and
 * `tot-<machine>-<id>` when two machines have a Tot with the same id.
 */
export const channelNameForTot = (
  tot: { readonly environment: string; readonly id: string },
  collides: boolean,
): string => (collides ? `tot-${labelSlug(tot.environment)}-${tot.id}` : channelNameFor(tot.id));

/** One `channelId=totId` or `channelId=label:totId` pin. */
export interface TotPin {
  /** Null lets a bare pin find the one machine holding that Tot id at setup. */
  readonly environment: string | null;
  readonly totId: string;
}

export interface ChannelTotMap {
  readonly map: ReadonlyMap<string, TotPin>;
  readonly problems: ReadonlyArray<string>;
}

const CHANNEL_ID = /^\d+$/u;
const TOT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;

/**
 * `channelId=totId` pairs, or `channelId=label:totId` when several machines are
 * configured. Whitespace or comma separated. Pinned channels are never renamed.
 */
export const parseChannelTotMap = (value: string | undefined): ChannelTotMap => {
  const map = new Map<string, TotPin>();
  const problems: Array<string> = [];
  const entries = (value ?? "")
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || entry.indexOf("=", separator + 1) !== -1) {
      problems.push(
        `CHANNEL_TOT_MAP entry ${entry} is not a channelId=totId or channelId=label:totId pair.`,
      );
      continue;
    }
    const channelId = entry.slice(0, separator);
    const target = entry.slice(separator + 1);
    if (!CHANNEL_ID.test(channelId)) {
      problems.push(
        `CHANNEL_TOT_MAP entry ${entry} is not a channelId=totId or channelId=label:totId pair.`,
      );
      continue;
    }
    const colon = target.indexOf(":");
    const environment = colon === -1 ? null : target.slice(0, colon);
    const totId = colon === -1 ? target : target.slice(colon + 1);
    if ((environment !== null && !LABEL.test(environment)) || !TOT_ID.test(totId)) {
      problems.push(
        `CHANNEL_TOT_MAP entry ${entry} is not a channelId=totId or channelId=label:totId pair.`,
      );
      continue;
    }
    if (map.has(channelId)) {
      problems.push(`CHANNEL_TOT_MAP lists channel ${channelId} more than once.`);
      continue;
    }
    map.set(channelId, { environment, totId });
  }
  return { map, problems };
};

export interface GuildTot {
  readonly id: string;
  readonly name: string;
  readonly avatar: TotAvatar;
  readonly environment: string;
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
  readonly environment: string;
  readonly totId: string;
  readonly channelId: string;
  readonly via: "pin" | "name";
}

export interface ChannelCreatePlan {
  readonly kind: "create";
  readonly environment: string;
  readonly totId: string;
  readonly name: string;
}

export type ChannelSkipReason =
  | "unknown-tot"
  | "ambiguous-tot"
  | "unknown-channel"
  | "not-text"
  | "already-bound";

export interface ChannelSkipPlan {
  readonly kind: "skip";
  /** Null when a bare pin matched no single machine. */
  readonly environment: string | null;
  readonly totId: string;
  readonly channelId: string | null;
  readonly reason: ChannelSkipReason;
}

export type ChannelPlan = ChannelBindingPlan | ChannelCreatePlan | ChannelSkipPlan;

const totKey = (tot: GuildTot): string => `${tot.environment}:${tot.id}`;

/**
 * One channel per Tot: pinned channels first, then a channel already named for
 * the Tot, then a new one. A channel name carries the machine only when two
 * machines share the Tot id. An existing channel is only ever reused, never
 * renamed or deleted, and a pin wins over a name.
 */
export const planGuildChannels = (input: {
  readonly tots: ReadonlyArray<GuildTot>;
  readonly channels: ReadonlyArray<GuildChannelView>;
  readonly pinned: ReadonlyMap<string, TotPin>;
}): ReadonlyArray<ChannelPlan> => {
  const channelsById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const byKey = new Map(input.tots.map((tot) => [totKey(tot), tot]));
  const idCounts = new Map<string, number>();
  for (const tot of input.tots) idCounts.set(tot.id, (idCounts.get(tot.id) ?? 0) + 1);
  const bound = new Set<string>();
  const claimed = new Set<string>();
  const plan: Array<ChannelPlan> = [];

  const resolvePin = (
    pin: TotPin,
  ):
    | { readonly tot: GuildTot; readonly reason?: undefined }
    | {
        readonly tot?: undefined;
        readonly reason: "unknown-tot" | "ambiguous-tot";
      } => {
    if (pin.environment !== null) {
      const tot = byKey.get(`${pin.environment}:${pin.totId}`);
      return tot === undefined ? { reason: "unknown-tot" } : { tot };
    }
    const matches = input.tots.filter((tot) => tot.id === pin.totId);
    if (matches.length === 0) return { reason: "unknown-tot" };
    if (matches.length > 1) return { reason: "ambiguous-tot" };
    return { tot: matches[0]! };
  };

  for (const [channelId, pin] of input.pinned) {
    const resolved = resolvePin(pin);
    if (resolved.tot === undefined) {
      plan.push({
        kind: "skip",
        environment: pin.environment,
        totId: pin.totId,
        channelId,
        reason: resolved.reason,
      });
      continue;
    }
    const tot = resolved.tot;
    const channel = channelsById.get(channelId);
    if (channel === undefined) {
      plan.push({
        kind: "skip",
        environment: tot.environment,
        totId: tot.id,
        channelId,
        reason: "unknown-channel",
      });
      continue;
    }
    if (!channel.textual) {
      plan.push({
        kind: "skip",
        environment: tot.environment,
        totId: tot.id,
        channelId,
        reason: "not-text",
      });
      continue;
    }
    const key = totKey(tot);
    if (bound.has(key)) {
      plan.push({
        kind: "skip",
        environment: tot.environment,
        totId: tot.id,
        channelId,
        reason: "already-bound",
      });
      continue;
    }
    bound.add(key);
    claimed.add(channelId);
    plan.push({
      kind: "bind",
      environment: tot.environment,
      totId: tot.id,
      channelId,
      via: "pin",
    });
  }

  for (const tot of input.tots) {
    const key = totKey(tot);
    if (bound.has(key)) continue;
    const name = channelNameForTot(tot, (idCounts.get(tot.id) ?? 0) > 1);
    const existing = input.channels.find(
      (channel) => channel.textual && channel.name === name && !claimed.has(channel.id),
    );
    if (existing !== undefined) {
      bound.add(key);
      claimed.add(existing.id);
      plan.push({
        kind: "bind",
        environment: tot.environment,
        totId: tot.id,
        channelId: existing.id,
        via: "name",
      });
      continue;
    }
    plan.push({ kind: "create", environment: tot.environment, totId: tot.id, name });
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
  readonly environment: string;
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
  readonly pinned: ReadonlyMap<string, TotPin>;
  readonly port: GuildPort;
  /** One store per machine, so two machines never share a face file. */
  readonly avatarsFor: (environment: string) => AvatarStore;
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
  const totsByKey = new Map(options.tots.map((tot) => [totKey(tot), tot]));

  const bind = async (
    channelId: string,
    tot: GuildTot,
    via: "pin" | "name" | "created",
  ): Promise<GuildChannelBinding | null> => {
    const { webhook, action } = await webhookFor({
      channelId,
      tot,
      port: options.port,
      avatars: options.avatarsFor(tot.environment),
      state: options.state,
    });
    if (webhook.token === null) {
      options.logger.warn("guild.webhook_unusable", {
        channelId,
        environment: tot.environment,
        totId: tot.id,
      });
      return null;
    }
    options.logger.info("guild.channel_ready", {
      channelId,
      environment: tot.environment,
      totId: tot.id,
      via,
      webhook: action,
    });
    return {
      channelId,
      environment: tot.environment,
      totId: tot.id,
      webhookId: webhook.id,
      webhookToken: webhook.token,
    };
  };

  for (const entry of plan) {
    if (entry.kind === "skip") {
      options.logger.warn("guild.channel_skipped", {
        environment: entry.environment,
        totId: entry.totId,
        ...(entry.channelId === null ? {} : { channelId: entry.channelId }),
        reason: entry.reason,
      });
      continue;
    }
    const tot = totsByKey.get(`${entry.environment}:${entry.totId}`);
    if (tot === undefined) continue;
    if (entry.kind === "bind") {
      try {
        const binding = await bind(entry.channelId, tot, entry.via);
        if (binding !== null) bindings.push(binding);
      } catch (cause) {
        options.logger.error("guild.channel_failed", {
          channelId: entry.channelId,
          environment: tot.environment,
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
        environment: tot.environment,
        totId: tot.id,
        name: channel.name,
      });
      const binding = await bind(createdChannelId, tot, "created");
      if (binding !== null) bindings.push(binding);
    } catch (cause) {
      options.logger.error("guild.channel_failed", {
        environment: tot.environment,
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
  | { readonly kind: "route"; readonly tot: TotRef; readonly text: string };

/**
 * A channel message only reaches a Tot when the channel is mapped, the author
 * is allowlisted and not a bot, and the message has text. Anything else is
 * ignored, so the bridge never answers a channel on someone else's behalf.
 */
export const routeGuildMessage = (input: {
  readonly channelId: string;
  readonly author: { readonly userId: string | null | undefined; readonly bot: boolean };
  readonly content: string;
  readonly channelTots: ReadonlyMap<string, TotRef>;
  readonly allowedUserIds: ReadonlySet<string>;
}): GuildMessageDecision => {
  const tot = input.channelTots.get(input.channelId);
  if (tot === undefined) return { kind: "ignore", reason: "unmapped" };
  if (input.author.bot) return { kind: "ignore", reason: "bot-author" };
  if (!isAllowedAuthor(input.author, input.allowedUserIds)) {
    return { kind: "ignore", reason: "not-allowed" };
  }
  const text = input.content.trim();
  if (text.length === 0) return { kind: "ignore", reason: "empty" };
  return { kind: "route", tot, text };
};
