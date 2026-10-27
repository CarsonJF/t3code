import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type Project,
  type ServerSettings,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell, liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as EnvironmentHandlers from "./handlers.ts";
import { EnvironmentToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:preferences");
const threadId = ThreadId.make("thread:preferences");

it.effect("refuses a preferences update when the caller's turn ends while it waits", () =>
  Effect.gen(function* () {
    const caller = yield* Ref.make<OrchestrationV2ThreadShell>(liveThreadShell(threadId));
    const updates = yield* Ref.make(0);
    const checked = yield* Deferred.make<void>();
    const layerDependencies = Layer.mergeAll(
      ThreadCommandExecutor.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId,
        requestNamespace: "provider:preferences",
        thread: {
          threadId,
          providerSessionId: "provider:preferences",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () =>
          Ref.get(caller).pipe(Effect.tap(() => Deferred.succeed(checked, undefined))),
      }),
      Layer.mock(Environment.ServerEnvironment)({
        getDescriptor: Effect.succeed({
          environmentId,
          label: "Test",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.0",
          capabilities: { repositoryIdentity: false },
        }),
      }),
      Layer.mock(Settings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        updateSettings: () =>
          Ref.update(updates, (count) => count + 1).pipe(Effect.as(DEFAULT_SERVER_SETTINGS)),
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* EnvironmentToolkit;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const held = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const holder = yield* executor
        .withLock(
          threadId,
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(held);
      const update = yield* toolkit
        .handle("t3_environment_preferences_update", { newWorktreesStartFromOrigin: true })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.forkChild);
      yield* Deferred.await(checked);
      yield* Ref.update(caller, (shell) => ({ ...shell, activeRunId: null }));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      const result = yield* Fiber.join(update);
      expect(result.at(-1)?.result).toMatchObject({ code: "parent_not_active" });
      expect(yield* Ref.get(updates)).toBe(0);
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(EnvironmentHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);

const projectId = ProjectId.make("project:groups");
const groupsLayer = (settings: Ref.Ref<ServerSettings>, updates: Ref.Ref<number>) =>
  McpToolAccess.HandlersLayer.layer(EnvironmentHandlers.layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ThreadCommandExecutor.layer,
        NodeCrypto.layer,
        liveThreadsLayer,
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId,
          requestNamespace: "provider:groups",
          thread: {
            threadId,
            providerSessionId: "provider:groups",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(Environment.ServerEnvironment)({
          getDescriptor: Effect.succeed({
            environmentId,
            label: "Test",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.0.0",
            capabilities: { repositoryIdentity: false },
          }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          snapshot: Effect.succeed({
            projects: [{ id: projectId, deletedAt: null } as Project],
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        }),
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: Ref.get(settings),
          updateSettings: (patch) =>
            Ref.update(updates, (count) => count + 1).pipe(
              Effect.andThen(
                Ref.updateAndGet(settings, (current) => applyServerSettingsPatch(current, patch)),
              ),
            ),
        }),
      ),
    ),
  );
const callGroupsTool = <Name extends "t3_thread_groups_read" | "t3_thread_groups_update">(
  name: Name,
  params: Parameters<Effect.Success<typeof EnvironmentToolkit>["handle"]>[1],
) =>
  Effect.gen(function* () {
    const toolkit = yield* EnvironmentToolkit;
    const results = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect);
    return results.at(-1)?.result;
  });

it.effect("creates a group, then puts a project's new threads in it", () =>
  Effect.gen(function* () {
    const settings = yield* Ref.make(DEFAULT_SERVER_SETTINGS);
    const updates = yield* Ref.make(0);
    yield* Effect.gen(function* () {
      const created = yield* callGroupsTool("t3_thread_groups_update", {
        ops: [{ type: "createGroup", name: "Work", color: "blue" }],
      });
      expect(created).toMatchObject({ groups: [{ name: "Work", color: "blue" }], projects: [] });
      const groupId = (yield* Ref.get(settings)).threadGroups.groups[0]!.id;
      yield* callGroupsTool("t3_thread_groups_update", {
        ops: [
          { type: "setProjectGroup", projectIds: [projectId], groupId },
          { type: "updateGroup", groupId, name: "Client work" },
        ],
      });
      expect(yield* callGroupsTool("t3_thread_groups_read", {})).toEqual({
        groups: [{ id: groupId, name: "Client work", color: "blue" }],
        projects: [{ projectId, groupId }],
      });
    }).pipe(Effect.provide(groupsLayer(settings, updates)));
  }),
);

it.effect("rejects the whole update when an op names a missing group or project", () =>
  Effect.gen(function* () {
    const settings = yield* Ref.make(DEFAULT_SERVER_SETTINGS);
    const updates = yield* Ref.make(0);
    yield* Effect.gen(function* () {
      const missingGroup = yield* callGroupsTool("t3_thread_groups_update", {
        ops: [
          { type: "createGroup", name: "Work" },
          { type: "setProjectGroup", projectIds: [projectId], groupId: "nope" },
        ],
      });
      expect(missingGroup).toMatchObject({ code: "invalid_request" });
      const missingProject = yield* callGroupsTool("t3_thread_groups_update", {
        ops: [{ type: "setProjectGroup", projectIds: [ProjectId.make("gone")], groupId: null }],
      });
      expect(missingProject).toMatchObject({ code: "invalid_request" });
      expect(yield* Ref.get(updates)).toBe(0);
    }).pipe(Effect.provide(groupsLayer(settings, updates)));
  }),
);
