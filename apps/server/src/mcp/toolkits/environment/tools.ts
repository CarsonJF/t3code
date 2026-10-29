import {
  BackgroundActivityProfile,
  BackgroundActivityProfileSelection,
  ExecutionEnvironmentDescriptor,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProjectColor,
  ProjectIconOverride,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
  ThreadGroup,
  ThreadGroupGradient,
  ThreadGroupId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const PreferenceFields = {
  defaultThreadEnvMode: ServerSettings.fields.defaultThreadEnvMode,
  newWorktreesStartFromOrigin: ServerSettings.fields.newWorktreesStartFromOrigin,
  enableProviderUpdateChecks: ServerSettings.fields.enableProviderUpdateChecks,
  backgroundActivity: Schema.Struct({ profile: BackgroundActivityProfileSelection }),
  sourceControlWritingStyle: Schema.Struct({
    mode: Schema.String,
    followChangeRequestTemplates: Schema.Boolean,
    customInstructions: Schema.String,
    truncated: Schema.Boolean,
  }),
};
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    Settings.ServerSettingsService,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
};
const EnvironmentReadTool = Tool.make("t3_environment_read", {
  ...shared,
  description:
    "Read this server's identity and preferences. Providers and models: `orchestrator_capabilities`.",
  parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
  success: Schema.Struct({
    environmentId: ExecutionEnvironmentDescriptor.fields.environmentId,
    label: Schema.String,
    serverVersion: Schema.String,
    platform: ExecutionEnvironmentDescriptor.fields.platform,
    preferences: Schema.Struct(PreferenceFields),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const EnvironmentPreferencesTool = Tool.make("t3_environment_preferences_update", {
  ...shared,
  description:
    "Update environment-wide preferences. Live full-access or default caller thread only. Omitted fields are unchanged; `customInstructions: ''` clears it.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    defaultThreadEnvMode: ServerSettingsPatch.fields.defaultThreadEnvMode,
    newWorktreesStartFromOrigin: ServerSettingsPatch.fields.newWorktreesStartFromOrigin,
    enableProviderUpdateChecks: ServerSettingsPatch.fields.enableProviderUpdateChecks,
    backgroundActivity: Schema.optionalKey(Schema.Struct({ profile: BackgroundActivityProfile })),
    sourceControlWritingStyle: ServerSettingsPatch.fields.sourceControlWritingStyle,
  }),
  success: Schema.Struct(PreferenceFields),
}).annotate(Tool.Destructive, true);
const ThreadGroupsResult = Schema.Struct({
  groups: Schema.Array(ThreadGroup),
  projects: Schema.Array(Schema.Struct({ projectId: ProjectId, groupId: ThreadGroupId })),
});
const ThreadGroupsReadTool = Tool.make("t3_thread_groups_read", {
  ...shared,
  description:
    "Read this environment's sidebar thread groups and each project's group (projects without one are omitted).",
  success: ThreadGroupsResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const groupColor = Schema.optionalKey(Schema.NullOr(ProjectColor));
const groupIcon = Schema.optionalKey(Schema.NullOr(ProjectIconOverride));
const groupGradient = Schema.optionalKey(Schema.NullOr(ThreadGroupGradient));
const ThreadGroupsUpdateTool = Tool.make("t3_thread_groups_update", {
  ...shared,
  description:
    "Edit sidebar thread groups. Live full-access or default caller thread only. Ops apply in order, all or none. `createGroup` returns the new id in `groups`; assign it in a later call. `setProjectGroup` moves the project's future threads only; `groupId: null` ungroups. `gradient` is {from, to} colors (set `color` to `from` too); `null` clears it. `reorderGroups` lists group ids in the new order. Deleting a group ungroups its threads.",
  parameters: Schema.Struct({
    ops: Schema.Array(
      Schema.Union([
        Schema.Struct({
          type: Schema.Literal("createGroup"),
          name: ThreadGroup.fields.name,
          color: groupColor,
          gradient: groupGradient,
          textColor: groupColor,
          icon: groupIcon,
        }),
        Schema.Struct({
          type: Schema.Literal("updateGroup"),
          groupId: ThreadGroupId,
          name: Schema.optionalKey(ThreadGroup.fields.name),
          color: groupColor,
          gradient: groupGradient,
          textColor: groupColor,
          icon: groupIcon,
        }),
        Schema.Struct({ type: Schema.Literal("deleteGroup"), groupId: ThreadGroupId }),
        Schema.Struct({
          type: Schema.Literal("reorderGroups"),
          groupIds: Schema.Array(ThreadGroupId).check(Schema.isMinLength(1)),
        }),
        Schema.Struct({
          type: Schema.Literal("setProjectGroup"),
          projectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
          groupId: Schema.NullOr(ThreadGroupId),
        }),
      ]),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  }),
  success: ThreadGroupsResult,
  dependencies: [...shared.dependencies, ProjectService.ProjectService, Crypto.Crypto],
}).annotate(Tool.Destructive, true);
export const EnvironmentToolkit = Toolkit.make(
  EnvironmentReadTool,
  EnvironmentPreferencesTool,
  ThreadGroupsReadTool,
  ThreadGroupsUpdateTool,
);
