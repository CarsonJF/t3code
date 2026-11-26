/**
 * A small External Companion Protocol v1 server for tests and local demos: manifest, history with
 * a `before` cursor, posts, needs-you answers, and the events socket. Tests drive it through the
 * returned handle; `scripts/mock-companion.ts` runs it on a fixed port.
 */
import type { CompanionEvent, CompanionManifest, CompanionMessage } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import type * as NetAddress from "effect/net/NetAddress";

export interface MockCompanionPost {
  readonly channel: string;
  readonly body: unknown;
}

export interface MockCompanion {
  readonly baseUrl: string;
  readonly token: string;
  readonly posts: Effect.Effect<ReadonlyArray<MockCompanionPost>>;
  readonly responses: Effect.Effect<ReadonlyArray<{ readonly id: string; readonly body: unknown }>>;
  /** How many event sockets have opened so far. */
  readonly socketsOpened: Effect.Effect<number>;
  readonly historyReads: Effect.Effect<number>;
  /** Sends an event, or any raw text, to every open socket. */
  readonly emit: (event: CompanionEvent | string) => Effect.Effect<void>;
  /** Closes every open socket, as a companion restart would. */
  readonly dropSockets: Effect.Effect<void>;
  readonly setHistory: (
    channel: string,
    messages: ReadonlyArray<CompanionMessage>,
  ) => Effect.Effect<void>;
  readonly setManifest: (manifest: unknown) => Effect.Effect<void>;
}

export const DEMO_MANIFEST: CompanionManifest = {
  protocol: "companion.v1",
  id: "demo",
  name: "Demo Companion",
  tagline: "A mock companion for tests",
  avatar: {
    style: "open-bot",
    figure: "rocket",
    color: "#0ea5e9",
    material: "soft",
    mood: "happy",
  },
  capabilities: { streaming: true, needsYou: true, linkedThreads: true, children: true },
  childrenLabel: "Helpers",
  children: [
    { id: "scout", name: "Scout", role: "Looks things up", unreadCount: 2 },
    {
      id: "scribe",
      name: "Scribe",
      role: "Writes things down",
      avatar: { style: "open-bot", figure: "mug", color: "#f59e0b" },
      unreadCount: 0,
    },
  ],
};

export const makeMockCompanion = Effect.fn("MockCompanion.make")(function* (options?: {
  readonly token?: string;
  readonly manifest?: unknown;
  readonly history?: Readonly<Record<string, ReadonlyArray<CompanionMessage>>>;
  /** The most a history page holds; small by default so tests page. */
  readonly pageSize?: number;
}) {
  const pageSize = options?.pageSize ?? 2;
  const token = options?.token ?? "mock-token";
  const manifest = yield* Ref.make<unknown>(options?.manifest ?? DEMO_MANIFEST);
  const history = yield* Ref.make<Readonly<Record<string, ReadonlyArray<CompanionMessage>>>>(
    options?.history ?? {},
  );
  const posts = yield* Ref.make<ReadonlyArray<MockCompanionPost>>([]);
  const responses = yield* Ref.make<ReadonlyArray<{ id: string; body: unknown }>>([]);
  const opened = yield* Ref.make(0);
  const historyReads = yield* Ref.make(0);
  const writers = yield* Ref.make<ReadonlySet<(text: string) => Effect.Effect<void>>>(new Set());
  const drop = yield* Ref.make(yield* Deferred.make<void>());

  const authorized = (request: HttpServerRequest.HttpServerRequest) =>
    request.headers.authorization === `Bearer ${token}`;
  const unauthorized = HttpServerResponse.jsonUnsafe({ error: "unauthorized" }, { status: 401 });
  const pathParam = (url: string, pattern: RegExp) => pattern.exec(url.split("?")[0] ?? "")?.[1];

  const routes = Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/companion/v1/manifest",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request)) return unauthorized;
        return HttpServerResponse.jsonUnsafe(yield* Ref.get(manifest));
      }),
    ),
    HttpRouter.add(
      "GET",
      "/companion/v1/channels/:channel/history",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request)) return unauthorized;
        yield* Ref.update(historyReads, (count) => count + 1);
        const channel = decodeURIComponent(
          pathParam(request.url, /\/channels\/([^/]+)\/history/) ?? "main",
        );
        const params = new URLSearchParams(request.url.split("?")[1] ?? "");
        const all = (yield* Ref.get(history))[channel] ?? [];
        const before = params.get("before");
        const end = before === null ? all.length : Math.max(0, Number(before));
        const limit = Math.min(Number(params.get("limit") ?? pageSize), pageSize);
        const start = Math.max(0, end - limit);
        return HttpServerResponse.jsonUnsafe({
          messages: all.slice(start, end),
          nextCursor: start === 0 ? null : String(start),
        });
      }),
    ),
    HttpRouter.add(
      "POST",
      "/companion/v1/channels/:channel/messages",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request)) return unauthorized;
        const channel = decodeURIComponent(
          pathParam(request.url, /\/channels\/([^/]+)\/messages/) ?? "main",
        );
        const body = yield* request.json.pipe(Effect.orElseSucceed(() => null));
        yield* Ref.update(posts, (current) => [...current, { channel, body }]);
        const clientMessageId =
          typeof body === "object" && body !== null && "clientMessageId" in body
            ? String(body.clientMessageId)
            : "unknown";
        return HttpServerResponse.jsonUnsafe(
          { messageId: `m-${clientMessageId}` },
          { status: 202 },
        );
      }),
    ),
    HttpRouter.add(
      "POST",
      "/companion/v1/needs-you/:id/respond",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request)) return unauthorized;
        const id = decodeURIComponent(
          pathParam(request.url, /\/needs-you\/([^/]+)\/respond/) ?? "",
        );
        const body = yield* request.json.pipe(Effect.orElseSucceed(() => null));
        yield* Ref.update(responses, (current) => [...current, { id, body }]);
        return HttpServerResponse.jsonUnsafe({ ok: true });
      }),
    ),
    HttpRouter.add(
      "GET",
      "/companion/v1/events",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request)) return unauthorized;
        const socket = yield* request.upgrade;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const write = yield* socket.writer;
            const pull = yield* Socket.readerString(socket);
            const send = (text: string) => write.write(text).pipe(Effect.ignore);
            yield* Ref.update(writers, (current) => new Set(current).add(send));
            yield* Ref.update(opened, (count) => count + 1);
            const dropped = yield* Ref.get(drop);
            yield* Effect.raceFirst(
              Effect.forever(pull).pipe(Effect.ignore),
              Deferred.await(dropped),
            ).pipe(
              Effect.ensuring(
                Ref.update(writers, (current) => {
                  const next = new Set(current);
                  next.delete(send);
                  return next;
                }),
              ),
            );
          }),
        ).pipe(Effect.ignoreCause);
        return HttpServerResponse.empty();
      }),
    ),
  );

  yield* Layer.build(HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }));
  const server = yield* HttpServer.HttpServer;
  const address = server.address as NetAddress.InetAddress;
  const host = address._tag === "InetAddressV6" ? "[::1]" : "127.0.0.1";

  return {
    baseUrl: `http://${host}:${address.port}`,
    token,
    posts: Ref.get(posts),
    responses: Ref.get(responses),
    socketsOpened: Ref.get(opened),
    historyReads: Ref.get(historyReads),
    emit: (event) =>
      Ref.get(writers).pipe(
        Effect.flatMap((current) =>
          Effect.forEach(
            current,
            (send) => send(typeof event === "string" ? event : JSON.stringify(event)),
            { discard: true },
          ),
        ),
      ),
    dropSockets: Effect.gen(function* () {
      const current = yield* Ref.get(drop);
      yield* Ref.set(drop, yield* Deferred.make<void>());
      yield* Deferred.succeed(current, undefined);
    }),
    setHistory: (channel, messages) =>
      Ref.update(history, (current) => ({ ...current, [channel]: messages })),
    setManifest: (next) => Ref.set(manifest, next),
  } satisfies MockCompanion;
}) as (options?: {
  readonly token?: string;
  readonly manifest?: unknown;
  readonly history?: Readonly<Record<string, ReadonlyArray<CompanionMessage>>>;
  readonly pageSize?: number;
}) => Effect.Effect<MockCompanion, never, Scope.Scope | HttpServer.HttpServer>;

export const message = (
  id: string,
  role: CompanionMessage["role"],
  text: string,
  extra: Partial<CompanionMessage> = {},
): CompanionMessage => ({
  id,
  role,
  createdAt: "2026-11-25T12:00:00.000Z",
  text,
  toolCalls: [],
  linkedThreads: [],
  needsYou: [],
  ...extra,
});
