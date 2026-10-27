import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSettingsWriteScope,
  ProjectId,
  requiredScopesForServerSettingsPatch,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ServerSettingsModule from "./serverSettings.ts";

const decodeServerSettingsJson = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings));

const layerServerSettings = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-thread-groups-test-" })),
    ),
  );

const PROJECT = ProjectId.make("project-1");
const group = (id: string) => ({ id, name: id });

it.layer(NodeServices.layer)("server thread groups", (it) => {
  it.effect("applies every client's concurrent edits instead of the last writer's copy", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({
        threadGroupOps: [{ type: "createGroup", group: group("xn") }],
      });
      yield* Effect.all(
        [
          service.updateSettings({
            threadGroupOps: [{ type: "updateGroup", groupId: "xn", name: "XN" }],
          }),
          service.updateSettings({
            threadGroupOps: [{ type: "updateGroup", groupId: "xn", color: "violet" }],
          }),
          service.updateSettings({
            threadGroupOps: [
              { type: "createGroup", group: group("phone") },
              { type: "setThreadGroup", threadId: ThreadId.make("a"), groupId: "phone" },
            ],
          }),
          service.updateSettings({
            threadGroupOps: [
              { type: "setThreadGroup", threadId: ThreadId.make("b"), groupId: "xn" },
            ],
          }),
        ],
        { concurrency: "unbounded" },
      );

      const { threadGroups } = yield* service.getSettings;
      assert.deepEqual(
        threadGroups.groups.toSorted((left, right) => left.id.localeCompare(right.id)),
        [group("phone"), { id: "xn", name: "XN", color: "violet" }],
      );
      assert.deepEqual(threadGroups.threadOverrides, {
        [ThreadId.make("a")]: "phone",
        [ThreadId.make("b")]: "xn",
      });
    }).pipe(Effect.provide(layerServerSettings())),
  );

  it.effect("persists and broadcasts group changes to other connected clients", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* ServerSettingsModule.ServerSettingsService;
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const changes = yield* service.subscribeChanges;

        const reply = yield* service.updateSettings({
          threadGroupOps: [
            { type: "createGroup", group: group("xn") },
            {
              type: "setProjectDefault",
              projectIds: [PROJECT],
              groupId: "xn",
              since: "2026-10-26T10:00:00.000Z",
            },
          ],
        });

        const received = Option.getOrThrow(yield* Stream.runHead(changes));
        const raw = yield* fs.readFileString(config.settingsPath);
        const saved = yield* decodeServerSettingsJson(raw);
        assert.deepEqual(received.threadGroups, reply.threadGroups);
        assert.deepEqual(saved.threadGroups, reply.threadGroups);
        assert.deepEqual(reply.threadGroups.projectDefaults, {
          [PROJECT]: [{ groupId: "xn", since: "2026-10-26T10:00:00.000Z" }],
        });
        assert.notInclude(raw, "threadGroupOps");
      }),
    ).pipe(Effect.provide(layerServerSettings())),
  );

  it.effect("reads settings saved before thread groups existed as having none", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(config.settingsPath, "{}");

      assert.deepEqual((yield* service.getSettings).threadGroups, {
        groups: [],
        projectDefaults: {},
        threadOverrides: {},
      });
    }).pipe(Effect.provide(layerServerSettings())),
  );

  it("requires settings:write to change groups", () => {
    assert.deepEqual(
      requiredScopesForServerSettingsPatch({
        threadGroupOps: [{ type: "deleteGroup", groupId: "xn" }],
      }),
      [AuthSettingsWriteScope],
    );
  });
});
