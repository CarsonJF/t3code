import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { it } from "@effect/vitest";
import {
  type ExternalCompanionChannelEvent,
  type ExternalCompanionConfig,
  type ExternalCompanionsState,
  type ServerSettings,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as ServerSettingsModule from "../serverSettings.ts";
import * as CompanionGrants from "./CompanionGrants.ts";
import * as ExternalCompanions from "./ExternalCompanions.ts";
import { DEMO_MANIFEST, makeMockCompanion, message } from "./mockCompanion.testkit.ts";

const noGrants = Layer.succeed(CompanionGrants.CompanionGrants, {
  issue: () => Effect.die("unused"),
  revoke: () => Effect.void,
  retain: () => Effect.void,
  status: () => Effect.succeed(null),
  exchange: () => Effect.die("unused"),
  companionForSession: () => Effect.undefined,
  changes: Stream.empty,
});

const noSecrets = Layer.succeed(SecretResolver.SecretResolver, {
  read: (references) => Effect.succeed(references.map(() => undefined)),
  invalidate: () => Effect.void,
  label: (provider) => Effect.succeed(provider),
});

/** Settings whose companions a test can change, with the change stream the service follows. */
const settingsWith = Effect.fn("test.settingsWith")(function* (
  initial: ReadonlyArray<ExternalCompanionConfig>,
) {
  const base = yield* ServerSettingsModule.ServerSettingsService.pipe(
    Effect.provide(ServerSettingsModule.ServerSettingsService.layerTest({})),
  );
  const current = yield* Ref.make<ServerSettings>({
    ...(yield* base.getSettings),
    externalCompanions: initial,
  });
  const changes = yield* PubSub.unbounded<ServerSettings>();
  const service: ServerSettingsModule.ServerSettingsService["Service"] = {
    ...base,
    getSettings: Ref.get(current),
    streamChanges: Stream.fromPubSub(changes),
  };
  const set = (companions: ReadonlyArray<ExternalCompanionConfig>) =>
    Ref.updateAndGet(current, (settings) => ({ ...settings, externalCompanions: companions })).pipe(
      Effect.flatMap((next) => PubSub.publish(changes, next)),
    );
  return { service, set };
});

const companionConfig = (baseUrl: string, token: string): ExternalCompanionConfig => ({
  id: "demo",
  label: "",
  baseUrl,
  token,
});

const start = Effect.fn("test.start")(function* (
  configs: (baseUrl: string, token: string) => ReadonlyArray<ExternalCompanionConfig>,
  mockOptions?: Parameters<typeof makeMockCompanion>[0],
) {
  const mock = yield* makeMockCompanion(mockOptions);
  const settings = yield* settingsWith(configs(mock.baseUrl, mock.token));
  // Built in the test's scope: the connections live as long as the layer does.
  const context = yield* Layer.build(
    ExternalCompanions.layerWith({
      backoff: Duration.millis(10),
      maxBackoff: Duration.millis(40),
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ServerSettingsModule.ServerSettingsService, settings.service),
          noSecrets,
          noGrants,
          FetchHttpClient.layer,
        ),
      ),
    ),
  );
  const companions = Context.get(context, ExternalCompanions.ExternalCompanions);
  return { mock, settings, companions };
});

const waitFor = (
  companions: ExternalCompanions.ExternalCompanions["Service"],
  predicate: (state: ExternalCompanionsState) => boolean,
) =>
  companions.state.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.timeout("5 seconds"),
    Effect.map(Option.getOrThrow),
  );

const waitForItems = (
  companions: ExternalCompanions.ExternalCompanions["Service"],
  predicate: (keys: ReadonlyArray<string>) => boolean,
) =>
  Stream.concat(Stream.succeed(undefined), companions.needsYouChanges).pipe(
    Stream.mapEffect(() => companions.needsYouItems),
    Stream.filter((items) => predicate(items.map((item) => item.key))),
    Stream.runHead,
    Effect.timeout("5 seconds"),
    Effect.map(Option.getOrThrow),
  );

const connected = (state: ExternalCompanionsState) =>
  state.companions[0]?.connection === "connected";

/** The channel's events, read one at a time. */
const openChannel = Effect.fn("test.openChannel")(function* (
  companions: ExternalCompanions.ExternalCompanions["Service"],
  channel: string,
) {
  const queue = yield* Queue.unbounded<ExternalCompanionChannelEvent>();
  yield* companions.channel({ companionId: "demo", channel }).pipe(
    Stream.runForEach((event) => Queue.offer(queue, event)),
    Effect.forkScoped,
  );
  return {
    next: Queue.take(queue).pipe(Effect.timeout("5 seconds")),
  };
});

describe("ExternalCompanions", () => {
  it.live("connects, keeps the manifest and follows avatar.state and child.updated", () =>
    Effect.gen(function* () {
      const { mock, companions } = yield* start((baseUrl, token) => [
        companionConfig(baseUrl, token),
      ]);
      const first = yield* waitFor(companions, connected);
      expect(first.companions[0]?.label).toBe("Demo Companion");
      expect(first.companions[0]?.manifest?.children.map((child) => child.id)).toEqual([
        "scout",
        "scribe",
      ]);
      yield* mock.emit({ type: "avatar.state", state: "working" });
      yield* mock.emit({ type: "avatar.state", childId: "scout", state: "waiting" });
      yield* mock.emit({
        type: "child.updated",
        child: { id: "scout", name: "Scout", unreadCount: 5 },
      });
      const updated = yield* waitFor(
        companions,
        (state) =>
          state.companions[0]?.manifest?.children[0]?.unreadCount === 5 &&
          state.companions[0]?.avatarStates.scout === "waiting",
      );
      expect(updated.companions[0]?.avatarStates).toEqual({ main: "working", scout: "waiting" });
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("refuses a manifest that is not companion.v1 and a wrong token, without their text", () =>
    Effect.gen(function* () {
      const { companions } = yield* start((baseUrl, token) => [companionConfig(baseUrl, token)], {
        manifest: { ...DEMO_MANIFEST, protocol: "companion.v2", name: "<b>evil</b>" },
      });
      const offline = yield* waitFor(
        companions,
        (state) => state.companions[0]?.connection === "offline",
      );
      expect(offline.companions[0]?.error).toMatch(/not Companion Protocol v1/);
      expect(offline.companions[0]?.manifest).toBeNull();
      const wrong = yield* companions
        .test({ baseUrl: offline.companions[0] ? "http://127.0.0.1:1" : "", token: "x" })
        .pipe(Effect.flip);
      expect(wrong.message).not.toContain("evil");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("tests a URL and token, and keeps a saved token to its own origin", () =>
    Effect.gen(function* () {
      const { mock, companions } = yield* start((baseUrl, token) => [
        companionConfig(baseUrl, token),
      ]);
      const manifest = yield* companions.test({ baseUrl: mock.baseUrl, token: mock.token });
      expect(manifest.name).toBe("Demo Companion");
      const refused = yield* companions
        .test({ baseUrl: mock.baseUrl, token: "wrong" })
        .pipe(Effect.flip);
      expect(refused.message).toMatch(/refused the token/);
      // The saved token goes to its own origin only.
      const saved = yield* companions.test({ baseUrl: mock.baseUrl, companionId: "demo" });
      expect(saved.id).toBe("demo");
      const elsewhere = yield* companions
        .test({ baseUrl: "http://127.0.0.2:9", companionId: "demo" })
        .pipe(Effect.flip);
      expect(elsewhere.message).toBe("Enter the companion's token.");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("streams a channel: its newest page, then only its own events, folded by clients", () =>
    Effect.gen(function* () {
      const { mock, companions } = yield* start(
        (baseUrl, token) => [companionConfig(baseUrl, token)],
        {
          history: {
            main: [
              message("a", "user", "one"),
              message("b", "assistant", "two"),
              message("c", "user", "three"),
            ],
          },
        },
      );
      yield* waitFor(companions, connected);
      const channel = yield* openChannel(companions, "main");
      const snapshot = yield* channel.next;
      expect(snapshot).toMatchObject({ type: "snapshot", nextCursor: "1" });
      expect(snapshot.type === "snapshot" ? snapshot.messages.map((m) => m.id) : []).toEqual([
        "b",
        "c",
      ]);
      const older = yield* companions.history({
        companionId: "demo",
        channel: "main",
        before: "1",
      });
      expect(older).toEqual({ messages: [message("a", "user", "one")], nextCursor: null });

      yield* mock.emit({
        type: "message.created",
        channel: "child:scout",
        message: message("x", "assistant", "elsewhere"),
      });
      yield* mock.emit("{not json");
      yield* mock.emit(JSON.stringify({ type: "message.delta", channel: "main", messageId: 7 }));
      yield* mock.emit({
        type: "message.created",
        channel: "main",
        message: message("d", "assistant", ""),
      });
      yield* mock.emit({ type: "message.delta", channel: "main", messageId: "d", delta: "Hel" });
      yield* mock.emit({
        type: "tool.state",
        channel: "main",
        messageId: "d",
        toolCall: { id: "t1", name: "search", status: "running" },
      });
      expect((yield* channel.next).type).toBe("message.created");
      expect(yield* channel.next).toEqual({
        type: "message.delta",
        channel: "main",
        messageId: "d",
        delta: "Hel",
      });
      expect((yield* channel.next).type).toBe("tool.state");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("reconnects with backoff and reads history again after the socket drops", () =>
    Effect.gen(function* () {
      const { mock, companions } = yield* start(
        (baseUrl, token) => [companionConfig(baseUrl, token)],
        { history: { main: [message("a", "assistant", "hi")] } },
      );
      yield* waitFor(companions, connected);
      const channel = yield* openChannel(companions, "main");
      expect((yield* channel.next).type).toBe("snapshot");
      const readsBefore = yield* mock.historyReads;
      yield* mock.setHistory("main", [
        message("a", "assistant", "hi"),
        message("b", "assistant", "while you were away"),
      ]);
      yield* mock.dropSockets;
      const resynced = yield* channel.next;
      expect(resynced.type === "snapshot" ? resynced.messages.map((m) => m.id) : []).toEqual([
        "a",
        "b",
      ]);
      expect(yield* mock.socketsOpened).toBe(2);
      expect(yield* mock.historyReads).toBeGreaterThan(readsBefore);
      yield* waitFor(companions, connected);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("posts messages with their clientMessageId and answers needs-you items", () =>
    Effect.gen(function* () {
      const { mock, companions } = yield* start((baseUrl, token) => [
        companionConfig(baseUrl, token),
      ]);
      yield* waitFor(companions, connected);
      const posted = yield* companions.send({
        companionId: "demo",
        channel: "child:scout",
        text: "look this up",
        clientMessageId: "c-1",
      });
      expect(posted).toEqual({ messageId: "m-c-1" });
      expect(yield* mock.posts).toEqual([
        {
          channel: "child:scout",
          body: { text: "look this up", clientMessageId: "c-1", source: "t3" },
        },
      ]);
      yield* companions.respond({
        companionId: "demo",
        needsYouId: "n-1",
        decision: "accept",
        answer: "yes",
      });
      expect(yield* mock.responses).toEqual([
        { id: "n-1", body: { decision: "accept", answer: "yes" } },
      ]);
      const missing = yield* companions
        .send({ companionId: "nope", channel: "main", text: "x", clientMessageId: "c-2" })
        .pipe(Effect.flip);
      expect(missing.message).toMatch(/not registered/);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("lists pending needs-you items from history and events until they are resolved", () =>
    Effect.gen(function* () {
      const { mock, companions } = yield* start(
        (baseUrl, token) => [companionConfig(baseUrl, token)],
        {
          history: {
            "child:scribe": [
              message("q", "assistant", "", {
                needsYou: [
                  {
                    id: "n-history",
                    kind: "question",
                    prompt: "Which file?",
                    options: ["a.md", "b.md"],
                    status: "pending",
                  },
                  { id: "n-old", kind: "approval", prompt: "Done", status: "resolved" },
                ],
              }),
            ],
          },
        },
      );
      yield* waitFor(companions, connected);
      yield* mock.emit({
        type: "needs_you.created",
        channel: "main",
        needsYou: { id: "n-live", kind: "approval", prompt: "Deploy?", status: "pending" },
      });
      yield* waitForItems(companions, (keys) => keys.includes("companion:demo:n-live"));
      const items = yield* companions.needsYouItems;
      expect(items.map((item) => [item.key, item.kind, item.title, item.summary])).toEqual([
        ["companion:demo:n-history", "companion", "Demo Companion · Scribe", "Which file?"],
        ["companion:demo:n-live", "companion", "Demo Companion", "Deploy?"],
      ]);
      expect(items[0]?.companion).toEqual({
        companionId: "demo",
        name: "Demo Companion",
        needsYouId: "n-history",
        channel: "child:scribe",
        kind: "question",
        options: ["a.md", "b.md"],
      });
      yield* mock.emit({ type: "needs_you.resolved", needsYouId: "n-live" });
      yield* waitForItems(companions, (keys) => !keys.includes("companion:demo:n-live"));
      expect((yield* companions.needsYouItems).map((item) => item.key)).toEqual([
        "companion:demo:n-history",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("drops theme CSS and effect a manifest or event tries to supply", () =>
    Effect.gen(function* () {
      const injected = {
        theme: { css: "body { display: none }", effect: "fetch('/steal')" },
        css: "body { display: none }",
      };
      const { mock, companions } = yield* start(
        (baseUrl, token) => [companionConfig(baseUrl, token)],
        {
          manifest: {
            ...DEMO_MANIFEST,
            ...injected,
            avatar: { ...DEMO_MANIFEST.avatar, ...injected },
            children: DEMO_MANIFEST.children.map((child) => ({ ...child, ...injected })),
          },
        },
      );
      yield* waitFor(companions, connected);
      yield* mock.emit(
        JSON.stringify({
          type: "child.updated",
          child: { id: "scout", name: "Scout", unreadCount: 1, ...injected },
        }),
      );
      const state = yield* waitFor(
        companions,
        (current) => current.companions[0]?.manifest?.children[0]?.unreadCount === 1,
      );
      const seen = JSON.stringify(state);
      expect(seen).not.toContain("display: none");
      expect(seen).not.toContain("steal");
      expect(state.companions[0]?.manifest).not.toHaveProperty("theme");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("keeps the connection when only the companion's theme changes", () =>
    Effect.gen(function* () {
      const { mock, settings, companions } = yield* start((baseUrl, token) => [
        companionConfig(baseUrl, token),
      ]);
      yield* waitFor(companions, connected);
      const opened = yield* mock.socketsOpened;
      yield* settings.set([
        { ...companionConfig(mock.baseUrl, mock.token), theme: { css: ".x { color: red }" } },
      ]);
      yield* mock.emit({ type: "avatar.state", state: "working" });
      yield* waitFor(companions, (state) => state.companions[0]?.avatarStates.main === "working");
      expect(yield* mock.socketsOpened).toBe(opened);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live("drops a removed companion and its items", () =>
    Effect.gen(function* () {
      const { settings, companions } = yield* start((baseUrl, token) => [
        companionConfig(baseUrl, token),
      ]);
      yield* waitFor(companions, connected);
      yield* settings.set([]);
      yield* waitFor(companions, (state) => state.companions.length === 0);
      expect(yield* companions.needsYouItems).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );
});
