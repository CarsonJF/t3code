/**
 * The server side of External Companion Protocol v1: one connection per registered companion,
 * kept open with backoff, and every HTTP call clients make through it. Clients never see a
 * companion's token. Every payload is decoded before use, and a companion's own error text is
 * never passed on.
 */
import {
  CompanionEvent,
  CompanionHistoryPage,
  CompanionManifest,
  type CompanionMessage,
  type CompanionNeedsYou,
  CompanionPostResult,
  type ExternalCompanionChannelEvent,
  type ExternalCompanionChannelRef,
  type ExternalCompanionConfig,
  ExternalCompanionError,
  type ExternalCompanionGrantIssueInput,
  type ExternalCompanionGrantIssueResult,
  type ExternalCompanionHistoryInput,
  type ExternalCompanionHistoryResult,
  type ExternalCompanionRespondInput,
  type ExternalCompanionSendInput,
  type ExternalCompanionsState,
  type ExternalCompanionStatus,
  type ExternalCompanionTestInput,
  type NeedsYouItem,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Socket from "effect/socket/Socket";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";
import * as CompanionGrants from "./CompanionGrants.ts";
import { isoAt } from "./CompanionGrants.ts";

const HTTP_TIMEOUT = Duration.seconds(10);
const HISTORY_LIMIT = 50;
// A socket that stayed up this long was healthy: the next drop starts the backoff over.
const STABLE_AFTER = Duration.seconds(30);
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

export interface ExternalCompanionsOptions {
  /** The first reconnect delay; it doubles up to `maxBackoff`. */
  readonly backoff?: Duration.Duration;
  readonly maxBackoff?: Duration.Duration;
}

type BusEvent =
  | { readonly companionId: string; readonly type: "resync" }
  | { readonly companionId: string; readonly type: "event"; readonly event: CompanionEvent };

interface Pending {
  readonly needsYou: CompanionNeedsYou;
  readonly channel: string;
  readonly at: string;
}

export class ExternalCompanions extends Context.Service<
  ExternalCompanions,
  {
    /** Every companion now, then again whenever one changes. */
    readonly state: Stream.Stream<ExternalCompanionsState>;
    readonly test: (
      input: ExternalCompanionTestInput,
    ) => Effect.Effect<CompanionManifest, ExternalCompanionError>;
    readonly channel: (
      ref: ExternalCompanionChannelRef,
    ) => Stream.Stream<ExternalCompanionChannelEvent, ExternalCompanionError>;
    readonly history: (
      input: ExternalCompanionHistoryInput,
    ) => Effect.Effect<ExternalCompanionHistoryResult, ExternalCompanionError>;
    readonly send: (
      input: ExternalCompanionSendInput,
    ) => Effect.Effect<CompanionPostResult, ExternalCompanionError>;
    readonly respond: (
      input: ExternalCompanionRespondInput,
    ) => Effect.Effect<void, ExternalCompanionError>;
    readonly issueGrant: (
      input: ExternalCompanionGrantIssueInput,
      tokenEndpoint: string,
    ) => Effect.Effect<ExternalCompanionGrantIssueResult, ExternalCompanionError>;
    readonly revokeGrant: (companionId: string) => Effect.Effect<void, ExternalCompanionError>;
    /** What companions wait on the user for, as Needs you items. */
    readonly needsYouItems: Effect.Effect<ReadonlyArray<NeedsYouItem>>;
    readonly needsYouChanges: Stream.Stream<void>;
  }
>()("t3/companions/ExternalCompanions") {}

const fail = (message: string) => new ExternalCompanionError({ message });
const isCompanionError = Schema.is(ExternalCompanionError);

const trimBase = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");
const eventsUrl = (baseUrl: string) =>
  `${trimBase(baseUrl).replace(/^http/, "ws")}/companion/v1/events`;

/** T3's own words for a failed call: never the companion's response text. */
const describe = (cause: unknown, baseUrl: string): string => {
  if (isCompanionError(cause)) return cause.message;
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tag = (cause as { _tag: string })._tag;
    if (tag === "TimeoutError") return `${baseUrl} did not answer in time.`;
    if (tag === "SchemaError")
      return `${baseUrl} sent an answer that is not Companion Protocol v1.`;
    if (tag === "HttpClientError") {
      const reason = (cause as { reason?: { _tag?: string; response?: { status?: number } } })
        .reason;
      const status = reason?.response?.status;
      if (status === 401 || status === 403) return `${baseUrl} refused the token.`;
      if (status !== undefined) return `${baseUrl} answered HTTP ${status}.`;
      return `Could not reach ${baseUrl}.`;
    }
  }
  return `Could not reach ${baseUrl}.`;
};

const isPending = (needsYou: CompanionNeedsYou) => needsYou.status === "pending";

const pendingFrom = (channel: string, messages: ReadonlyArray<CompanionMessage>) =>
  messages.flatMap((message) =>
    message.needsYou
      .filter(isPending)
      .map((needsYou): Pending => ({ needsYou, channel, at: message.createdAt })),
  );

const makeWith = Effect.fn("ExternalCompanions.make")(function* (
  options: ExternalCompanionsOptions,
) {
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* SecretResolver.SecretResolver;
  const grants = yield* CompanionGrants.CompanionGrants;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const webSocketConstructor = yield* Socket.WebSocketConstructor;
  const backoff = options.backoff ?? Duration.seconds(1);
  const maxBackoff = options.maxBackoff ?? Duration.seconds(60);

  const configs = yield* Ref.make<ReadonlyMap<string, ExternalCompanionConfig>>(new Map());
  const statuses = yield* SubscriptionRef.make<
    ReadonlyMap<string, Omit<ExternalCompanionStatus, "grant">>
  >(new Map());
  const pending = yield* Ref.make<ReadonlyMap<string, ReadonlyMap<string, Pending>>>(new Map());
  const pendingChanged = yield* PubSub.unbounded<void>();
  const bus = yield* PubSub.unbounded<BusEvent>();
  const connections = yield* FiberMap.make<string>();

  const updateStatus = (
    id: string,
    change: (
      current: Omit<ExternalCompanionStatus, "grant">,
    ) => Omit<ExternalCompanionStatus, "grant">,
  ) =>
    SubscriptionRef.update(statuses, (current) => {
      const existing = current.get(id);
      if (existing === undefined) return current;
      const next = new Map(current);
      next.set(id, change(existing));
      return next;
    });

  const setPending = (
    id: string,
    change: (current: ReadonlyMap<string, Pending>) => ReadonlyMap<string, Pending>,
  ) =>
    Ref.update(pending, (current) => {
      const next = new Map(current);
      next.set(id, change(current.get(id) ?? new Map()));
      return next;
    }).pipe(Effect.andThen(PubSub.publish(pendingChanged, undefined)));

  const tokenFor = (value: SettingsSecretValue) =>
    requireSettingsSecret(secrets, value).pipe(
      Effect.mapError(() =>
        fail("The companion's token could not be read from its secret provider."),
      ),
    );

  const call = <S extends Schema.Top>(
    baseUrl: string,
    token: string,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
  ) =>
    http.execute(request.pipe(HttpClientRequest.bearerToken(token))).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.scoped,
      Effect.timeout(HTTP_TIMEOUT),
      Effect.mapError((cause) => fail(describe(cause, trimBase(baseUrl)))),
    ) as Effect.Effect<S["Type"], ExternalCompanionError, S["DecodingServices"]>;

  const configOf = (companionId: string) =>
    Ref.get(configs).pipe(
      Effect.flatMap((current) => {
        const config = current.get(companionId);
        return config === undefined
          ? Effect.fail(fail("That companion is not registered on this server."))
          : Effect.succeed(config);
      }),
    );

  const fetchManifest = (baseUrl: string, token: string) =>
    call(
      baseUrl,
      token,
      HttpClientRequest.get(`${trimBase(baseUrl)}/companion/v1/manifest`),
      CompanionManifest,
    );

  const fetchHistory = (
    config: ExternalCompanionConfig,
    token: string,
    channel: string,
    before?: string,
    limit = HISTORY_LIMIT,
  ) =>
    call(
      config.baseUrl,
      token,
      HttpClientRequest.get(
        `${trimBase(config.baseUrl)}/companion/v1/channels/${channel}/history`,
      ).pipe(
        HttpClientRequest.setUrlParams({
          limit: String(limit),
          ...(before === undefined ? {} : { before }),
        }),
      ),
      CompanionHistoryPage,
    ).pipe(
      Effect.map((page): ExternalCompanionHistoryResult => ({
        messages: page.messages,
        nextCursor: page.nextCursor ?? null,
      })),
    );

  const applyEvent = (id: string, event: CompanionEvent) => {
    switch (event.type) {
      case "child.updated":
        return updateStatus(id, (status) =>
          status.manifest === null
            ? status
            : {
                ...status,
                manifest: {
                  ...status.manifest,
                  children: status.manifest.children.some((child) => child.id === event.child.id)
                    ? status.manifest.children.map((child) =>
                        child.id === event.child.id ? event.child : child,
                      )
                    : [...status.manifest.children, event.child],
                },
              },
        );
      case "avatar.state":
        return updateStatus(id, (status) => ({
          ...status,
          avatarStates: { ...status.avatarStates, [event.childId ?? "main"]: event.state },
        }));
      case "needs_you.created":
        return isPending(event.needsYou)
          ? Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                setPending(id, (current) =>
                  new Map(current).set(event.needsYou.id, {
                    needsYou: event.needsYou,
                    channel: event.channel,
                    at: isoAt(now),
                  }),
                ),
              ),
            )
          : Effect.void;
      case "needs_you.resolved":
        return setPending(id, (current) => {
          const next = new Map(current);
          next.delete(event.needsYouId);
          return next;
        });
      case "message.created":
      case "message.done": {
        const message = event.message;
        if (message === undefined || message.needsYou.length === 0) return Effect.void;
        return setPending(id, (current) => {
          const next = new Map(current);
          for (const needsYou of message.needsYou) {
            if (isPending(needsYou)) {
              next.set(needsYou.id, { needsYou, channel: event.channel, at: message.createdAt });
            } else next.delete(needsYou.id);
          }
          return next;
        });
      }
      default:
        return Effect.void;
    }
  };

  const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(CompanionEvent));

  /** One connection: manifest, socket, catch-up, then frames until it drops. */
  const connectOnce = Effect.fn("ExternalCompanions.connectOnce")(function* (
    config: ExternalCompanionConfig,
  ) {
    const token = yield* tokenFor(config.token);
    const manifest = yield* fetchManifest(config.baseUrl, token);
    yield* updateStatus(config.id, (status) => ({
      ...status,
      label: manifest.name,
      manifest,
      error: null,
    }));
    const socket = yield* Socket.makeWebSocket(eventsUrl(config.baseUrl), {
      openTimeout: HTTP_TIMEOUT,
      headers: { authorization: `Bearer ${token}` },
      highWaterMark: MAX_FRAME_BYTES,
    }).pipe(Effect.provideService(Socket.WebSocketConstructor, webSocketConstructor));
    const pull = yield* Socket.readerString(socket).pipe(
      Effect.mapError(() => fail(`Could not open ${eventsUrl(config.baseUrl)}.`)),
    );
    const openedAt = yield* Clock.currentTimeMillis;
    // Anything that happened while away is in history: read it again, and tell viewers to.
    const channels = ["main", ...manifest.children.map((child) => `child:${child.id}`)];
    const pages = yield* Effect.forEach(
      channels,
      (channel) =>
        fetchHistory(config, token, channel).pipe(
          Effect.map((page) => pendingFrom(channel, page.messages)),
          Effect.orElseSucceed(() => []),
        ),
      { concurrency: 4 },
    );
    yield* setPending(
      config.id,
      () => new Map(pages.flat().map((entry) => [entry.needsYou.id, entry])),
    );
    yield* PubSub.publish(bus, { companionId: config.id, type: "resync" });
    // Connected once caught up, so nothing reads a half-synced companion as live.
    yield* updateStatus(config.id, (status) => ({
      ...status,
      connection: "connected",
      error: null,
    }));
    const stableFor = yield* Effect.gen(function* () {
      while (true) {
        const frames = yield* pull;
        for (const frame of frames) {
          const event = decodeFrame(frame);
          if (Option.isNone(event)) continue;
          yield* applyEvent(config.id, event.value);
          yield* PubSub.publish(bus, { companionId: config.id, type: "event", event: event.value });
        }
      }
    }).pipe(Effect.catch(() => Clock.currentTimeMillis.pipe(Effect.map((now) => now - openedAt))));
    return stableFor;
  }, Effect.scoped);

  const runCompanion = Effect.fn("ExternalCompanions.runCompanion")(function* (
    config: ExternalCompanionConfig,
  ) {
    let attempt = 0;
    while (true) {
      yield* updateStatus(config.id, (status) => ({ ...status, connection: "connecting" }));
      const outcome = yield* connectOnce(config).pipe(Effect.result);
      const lostMessage =
        outcome._tag === "Success"
          ? `The connection to ${trimBase(config.baseUrl)} closed.`
          : outcome.failure.message;
      if (outcome._tag === "Success" && outcome.success >= Duration.toMillis(STABLE_AFTER)) {
        attempt = 0;
      }
      yield* updateStatus(config.id, (status) => ({
        ...status,
        connection: "offline",
        error: lostMessage,
        avatarStates: {},
      }));
      const delay = Math.min(
        Duration.toMillis(maxBackoff),
        Duration.toMillis(backoff) * 2 ** Math.min(attempt, 16),
      );
      attempt += 1;
      yield* Effect.sleep(Duration.millis(delay));
    }
  });

  const fingerprint = (config: ExternalCompanionConfig) => JSON.stringify(config);

  const syncConfigs = Effect.fn("ExternalCompanions.syncConfigs")(function* (
    next: ReadonlyArray<ExternalCompanionConfig>,
  ) {
    const previous = yield* Ref.get(configs);
    const nextMap = new Map(next.map((config) => [config.id, config]));
    yield* Ref.set(configs, nextMap);
    for (const id of previous.keys()) {
      if (nextMap.has(id)) continue;
      yield* FiberMap.remove(connections, id);
      yield* SubscriptionRef.update(statuses, (current) => {
        const copy = new Map(current);
        copy.delete(id);
        return copy;
      });
      yield* Ref.update(pending, (current) => {
        const copy = new Map(current);
        copy.delete(id);
        return copy;
      });
      yield* PubSub.publish(pendingChanged, undefined);
    }
    for (const config of next) {
      const before = previous.get(config.id);
      if (before !== undefined && fingerprint(before) === fingerprint(config)) continue;
      yield* SubscriptionRef.update(statuses, (current) =>
        new Map(current).set(config.id, {
          id: config.id,
          label: config.label || config.id,
          connection: "connecting",
          error: null,
          manifest: null,
          avatarStates: {},
        }),
      );
      yield* FiberMap.run(connections, config.id, runCompanion(config));
    }
    yield* grants.retain(new Set(nextMap.keys()));
  });

  yield* syncConfigs(
    (yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null)))?.externalCompanions ?? [],
  );
  yield* settings.streamChanges.pipe(
    Stream.map((current) => current.externalCompanions),
    Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
    Stream.runForEach(syncConfigs),
    Effect.forkScoped,
  );

  const snapshot = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(statuses);
    const order = [...(yield* Ref.get(configs)).keys()];
    const companions = yield* Effect.forEach(
      order.flatMap((id) => {
        const status = current.get(id);
        return status === undefined ? [] : [status];
      }),
      (status) => grants.status(status.id).pipe(Effect.map((grant) => ({ ...status, grant }))),
    );
    return { companions };
  });

  const state: ExternalCompanions["Service"]["state"] = Stream.merge(
    SubscriptionRef.changes(statuses).pipe(Stream.as(undefined)),
    grants.changes,
  ).pipe(
    Stream.mapEffect(() => snapshot),
    Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
  );

  const test: ExternalCompanions["Service"]["test"] = Effect.fn("ExternalCompanions.test")(
    function* (input) {
      if (!/^https?:\/\/[^\s]+$/.test(input.baseUrl.trim())) {
        return yield* fail("Enter an http:// or https:// URL.");
      }
      const saved =
        input.companionId === undefined
          ? undefined
          : (yield* Ref.get(configs)).get(input.companionId);
      const useSaved = input.token === undefined || input.token === SECRET_REDACTED;
      // A saved token only goes to the origin it was saved for.
      if (
        useSaved &&
        (saved === undefined || new URL(saved.baseUrl).origin !== new URL(input.baseUrl).origin)
      ) {
        return yield* fail("Enter the companion's token.");
      }
      const token = yield* tokenFor(
        useSaved ? (saved as ExternalCompanionConfig).token : (input.token as SettingsSecretValue),
      );
      if (token.trim() === "") return yield* fail("Enter the companion's token.");
      return yield* fetchManifest(input.baseUrl, token);
    },
  );

  const withToken = <A>(
    companionId: string,
    use: (
      config: ExternalCompanionConfig,
      token: string,
    ) => Effect.Effect<A, ExternalCompanionError>,
  ) =>
    configOf(companionId).pipe(
      Effect.flatMap((config) =>
        tokenFor(config.token).pipe(Effect.flatMap((token) => use(config, token))),
      ),
    );

  const history: ExternalCompanions["Service"]["history"] = (input) =>
    withToken(input.companionId, (config, token) =>
      fetchHistory(config, token, input.channel, input.before, input.limit),
    );

  const channel: ExternalCompanions["Service"]["channel"] = (ref) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* configOf(ref.companionId);
        const subscription = yield* PubSub.subscribe(bus);
        const page = (): Effect.Effect<ExternalCompanionChannelEvent, ExternalCompanionError> =>
          history({ ...ref }).pipe(
            Effect.map((result) => ({ type: "snapshot" as const, ...result })),
          );
        const first = yield* page();
        const forThisChannel = (entry: BusEvent) => {
          if (entry.companionId !== ref.companionId) return false;
          if (entry.type === "resync") return true;
          const event = entry.event;
          if (event.type === "child.updated" || event.type === "avatar.state") return false;
          return event.type === "needs_you.resolved" || event.channel === ref.channel;
        };
        const events = Stream.fromSubscription(subscription).pipe(
          Stream.filter(forThisChannel),
          // A resync that cannot be read keeps the view; the next reconnect tries again.
          Stream.mapEffect((entry) =>
            entry.type === "resync"
              ? page().pipe(Effect.option)
              : Effect.succeedSome<ExternalCompanionChannelEvent>(entry.event),
          ),
          Stream.filter(Option.isSome),
          Stream.map((entry) => entry.value),
        );
        return Stream.concat(Stream.succeed(first), events);
      }),
    );

  const send: ExternalCompanions["Service"]["send"] = Effect.fn("ExternalCompanions.send")(
    function* (input) {
      return yield* withToken(input.companionId, (config, token) =>
        call(
          config.baseUrl,
          token,
          HttpClientRequest.post(
            `${trimBase(config.baseUrl)}/companion/v1/channels/${input.channel}/messages`,
          ).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              text: input.text,
              clientMessageId: input.clientMessageId,
              source: "t3",
            }),
          ),
          CompanionPostResult,
        ),
      );
    },
  );

  const respond: ExternalCompanions["Service"]["respond"] = Effect.fn("ExternalCompanions.respond")(
    function* (input) {
      yield* withToken(input.companionId, (config, token) =>
        call(
          config.baseUrl,
          token,
          HttpClientRequest.post(
            `${trimBase(config.baseUrl)}/companion/v1/needs-you/${input.needsYouId}/respond`,
          ).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              decision: input.decision,
              ...(input.answer === undefined ? {} : { answer: input.answer }),
            }),
          ),
          Schema.Unknown,
        ),
      );
      // The companion confirms with needs_you.resolved; until then the item is answered here.
      yield* setPending(input.companionId, (current) => {
        const next = new Map(current);
        next.delete(input.needsYouId);
        return next;
      });
    },
  );

  const issueGrant: ExternalCompanions["Service"]["issueGrant"] = Effect.fn(
    "ExternalCompanions.issueGrant",
  )(function* (input, tokenEndpoint) {
    const config = yield* configOf(input.companionId);
    const status = (yield* SubscriptionRef.get(statuses)).get(config.id);
    const issued = yield* grants.issue({
      companionId: config.id,
      label: `Companion: ${status?.label ?? config.label ?? config.id}`,
      access: input.access,
    });
    return {
      setupCode: issued.setupCode,
      expiresAt: isoAt(issued.expiresAt),
      tokenEndpoint,
    };
  });

  const revokeGrant: ExternalCompanions["Service"]["revokeGrant"] = (companionId) =>
    grants.revoke(companionId);

  const needsYouItems: ExternalCompanions["Service"]["needsYouItems"] = Effect.gen(function* () {
    const current = yield* Ref.get(pending);
    const labels = yield* SubscriptionRef.get(statuses);
    return [...current.entries()].flatMap(([companionId, entries]) => {
      const status = labels.get(companionId);
      const name = status?.label ?? companionId;
      return [...entries.values()].map((entry): NeedsYouItem => {
        const childId = entry.channel.startsWith("child:") ? entry.channel.slice(6) : null;
        const child =
          childId === null
            ? undefined
            : status?.manifest?.children.find((candidate) => candidate.id === childId);
        return {
          key: `companion:${companionId}:${entry.needsYou.id}`,
          kind: "companion",
          threadId: null,
          title: child === undefined ? name : `${name} · ${child.name}`,
          summary: entry.needsYou.prompt,
          at: entry.at,
          totId: null,
          companion: {
            companionId,
            name,
            needsYouId: entry.needsYou.id,
            channel: entry.channel,
            kind: entry.needsYou.kind,
            options: entry.needsYou.options ?? [],
          },
        };
      });
    });
  });

  return ExternalCompanions.of({
    state,
    test,
    channel,
    history,
    send,
    respond,
    issueGrant,
    revokeGrant,
    needsYouItems,
    needsYouChanges: Stream.fromPubSub(pendingChanged),
  });
});

/** Node's own WebSocket, which takes handshake headers; a failed dial must not throw globally. */
const webSocketConstructorLayer = Layer.effect(
  Socket.WebSocketConstructor,
  Effect.gen(function* () {
    const make = yield* Socket.WebSocketConstructor;
    return (url, options) => {
      const socket = make(url, options);
      socket.addEventListener("error", () => undefined);
      return socket;
    };
  }),
).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor));

export const layerWith = (options: ExternalCompanionsOptions) =>
  Layer.effect(ExternalCompanions, makeWith(options)).pipe(
    Layer.provide(webSocketConstructorLayer),
  );

export const layer = layerWith({});
