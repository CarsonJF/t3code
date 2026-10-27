import {
  OrchestratorMcpFailure,
  ProjectId,
  type ServerSettings,
  type ThreadGroupOp,
  type ThreadGroupsState,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, unavailable } from "../../threadAccess.ts";
import { EnvironmentToolkit } from "./tools.ts";

export function preferences(settings: ServerSettings) {
  const {
    defaultThreadEnvMode,
    newWorktreesStartFromOrigin,
    enableProviderUpdateChecks,
    backgroundActivity,
    sourceControlWritingStyle,
  } = settings;
  const characters = Array.from(sourceControlWritingStyle.customInstructions);
  return {
    defaultThreadEnvMode,
    newWorktreesStartFromOrigin,
    enableProviderUpdateChecks,
    backgroundActivity: { profile: backgroundActivity.profile },
    sourceControlWritingStyle: {
      ...sourceControlWritingStyle,
      customInstructions: characters.slice(0, 4000).join(""),
      truncated: characters.length > 4000,
    },
  };
}
function threadGroups(state: ThreadGroupsState) {
  const known = new Set(state.groups.map((group) => group.id));
  return {
    groups: state.groups,
    projects: Object.entries(state.projectDefaults).flatMap(([projectId, entries]) => {
      const groupId = entries.at(-1)?.groupId;
      return groupId != null && known.has(groupId)
        ? [{ projectId: ProjectId.make(projectId), groupId }]
        : [];
    }),
  };
}
const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const access = Effect.gen(function* () {
  const context = yield* readCaller();
  const environment = yield* Environment.ServerEnvironment;
  const descriptor = yield* environment.getDescriptor;
  if (descriptor.environmentId !== context.scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
  return { ...context, descriptor, settings: yield* Settings.ServerSettingsService };
});
export const layer = McpToolAccess.toLayer(EnvironmentToolkit, {
  t3_environment_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const { descriptor, settings } = yield* access;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      return {
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        serverVersion: descriptor.serverVersion,
        platform: descriptor.platform,
        preferences: preferences(current),
      };
    }),
  ),
  t3_environment_preferences_update: McpToolAccess.writesEnvironment((patch, check) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const update = Effect.gen(function* () {
        // The turn may have ended, or the thread's modes changed, while this waited for the lock.
        yield* check;
        const { settings } = yield* access;
        return preferences(
          yield* settings.updateSettings(patch).pipe(Effect.mapError(unavailable)),
        );
      });
      return yield* scope.thread === undefined
        ? update
        : executor.withLock(scope.thread.threadId, update);
    }),
  ),
  t3_thread_groups_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const { settings } = yield* access;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      return threadGroups(current.threadGroups);
    }),
  ),
  t3_thread_groups_update: McpToolAccess.writesEnvironment(({ ops }, check) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const crypto = yield* Crypto.Crypto;
      const projects = yield* Project.ProjectService;
      const update = Effect.gen(function* () {
        yield* check;
        const { settings } = yield* access;
        const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
        const snapshot = yield* projects.snapshot.pipe(Effect.mapError(unavailable));
        const liveProjects = new Set(
          snapshot.projects
            .filter((project) => project.deletedAt === null)
            .map((project) => project.id),
        );
        // The settings patch silently drops ops naming a missing group, so check them first.
        const groups = new Set(current.threadGroups.groups.map((group) => group.id));
        const since = DateTime.formatIso(yield* DateTime.now);
        const threadGroupOps: ThreadGroupOp[] = [];
        for (const op of ops) {
          if (op.type === "createGroup") {
            const { type: _type, ...details } = op;
            const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
            threadGroupOps.push({ type: "createGroup", group: { id, ...details } });
            continue;
          }
          if (op.groupId !== null && !groups.has(op.groupId))
            return yield* invalid(`No thread group has id ${op.groupId}.`);
          if (op.type === "deleteGroup") groups.delete(op.groupId);
          if (op.type !== "setProjectGroup") {
            threadGroupOps.push(op);
            continue;
          }
          const missing = op.projectIds.find((projectId) => !liveProjects.has(projectId));
          if (missing !== undefined) return yield* invalid(`No project has id ${missing}.`);
          threadGroupOps.push({
            type: "setProjectDefault",
            projectIds: op.projectIds,
            groupId: op.groupId,
            since,
          });
        }
        const next = yield* settings
          .updateSettings({ threadGroupOps })
          .pipe(Effect.mapError(unavailable));
        return threadGroups(next.threadGroups);
      });
      return yield* scope.thread === undefined
        ? update
        : executor.withLock(scope.thread.threadId, update);
    }),
  ),
});
