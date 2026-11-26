import {
  CommandId,
  type EnvironmentId,
  MessageId,
  type ScheduledTaskId,
  type ThreadId,
  type TotId,
} from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { failureNoticeTotThread } from "../orchestration-v2/UsageLimitFallback.ts";
import * as ServerSettingsService from "../serverSettings.ts";

export interface ScheduledRunFailure {
  readonly taskId: ScheduledTaskId;
  readonly title: string;
  readonly ownerTotId: TotId | null;
  /** When the occurrence started; with the task id it names the occurrence, so a replay sends nothing new. */
  readonly startedAtIso: string;
  /** Such as `usage_limit` or `provider_error`, or `dispatch_failed` when no run started. */
  readonly errorClass: string;
  readonly failedAtIso: string;
  /** The thread the run was in; null when the dispatch never made one. */
  readonly threadId: ThreadId | null;
}

export interface LookAroundAttention {
  readonly taskId: ScheduledTaskId;
  readonly title: string;
  readonly ownerTotId: TotId | null;
  /** With the task id it names the sweep, so a replay sends nothing new. */
  readonly startedAtIso: string;
  readonly findings: ReadonlyArray<string>;
  readonly threadId: ThreadId;
}

const formatLookAroundAttention = (attention: LookAroundAttention, link: string) =>
  [
    `Look around found something: "${attention.title}"`,
    ...attention.findings.map((finding) => `- ${finding}`),
    `Sweep: ${link}`,
  ].join("\n");

const formatScheduledRunFailure = (failure: ScheduledRunFailure, link: string | null) =>
  [
    `Scheduled task failed: "${failure.title}"`,
    `Error: ${failure.errorClass}`,
    `Time: ${failure.failedAtIso}`,
    `Run: ${link ?? "no thread was started"}`,
  ].join("\n");

/**
 * Tells the owning Tot, or Home, that a scheduled run failed or a sweep found something.
 * Without the live layer, nothing.
 */
export class ScheduledRunAlerts extends Context.Reference<{
  readonly notifyFailure: (failure: ScheduledRunFailure) => Effect.Effect<void>;
  readonly notifySweepAttention: (attention: LookAroundAttention) => Effect.Effect<void>;
}>("t3/scheduledTasks/ScheduledRunAlerts", {
  defaultValue: () => ({
    notifyFailure: () => Effect.void,
    notifySweepAttention: () => Effect.void,
  }),
}) {}

export const layer = Layer.effect(
  ScheduledRunAlerts,
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const settingsService = yield* ServerSettingsService.ServerSettingsService;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const sendToTot = Effect.fn("ScheduledRunAlerts.sendToTot")(function* (
      ownerTotId: TotId | null,
      id: string,
      text: (environmentId: EnvironmentId) => string,
    ) {
      const settings = yield* settingsService.getSettings;
      const target = failureNoticeTotThread(settings, ownerTotId);
      if (target === null) return;
      const shell = yield* threads.getThreadShell(target);
      if (shell === null || shell.deletedAt != null || shell.archivedAt !== null) return;
      const environmentId = yield* environment.getEnvironmentId;
      yield* threads.sendToThread({
        projectId: shell.projectId,
        commandId: CommandId.make(id),
        threadId: target,
        messageId: MessageId.make(id),
        text: text(environmentId),
        attachments: [],
        mode: "auto",
        createdBy: "system",
        creationSource: "server",
      });
    });
    const notifySweepAttention = Effect.fn("ScheduledRunAlerts.notifySweepAttention")(
      function* (attention: LookAroundAttention) {
        yield* sendToTot(
          attention.ownerTotId,
          `look-around-attention:${attention.taskId}:${attention.startedAtIso}`,
          (environmentId) =>
            formatLookAroundAttention(
              attention,
              formatThreadLink({ environmentId, threadId: attention.threadId }, attention.title),
            ),
        );
      },
      (effect, attention) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not report what a sweep found", {
              taskId: attention.taskId,
              cause,
            }),
          ),
        ),
    );
    const notifyFailure = Effect.fn("ScheduledRunAlerts.notifyFailure")(
      function* (failure: ScheduledRunFailure) {
        const settings = yield* settingsService.getSettings;
        const target = failureNoticeTotThread(settings, failure.ownerTotId);
        // A run in the Tot's own thread already shows its failure there.
        if (target === null || target === failure.threadId) return;
        const shell = yield* threads.getThreadShell(target);
        if (shell === null || shell.deletedAt != null || shell.archivedAt !== null) return;
        const environmentId = yield* environment.getEnvironmentId;
        const link =
          failure.threadId === null
            ? null
            : formatThreadLink({ environmentId, threadId: failure.threadId }, failure.title);
        const id = `scheduled-task-failed:${failure.taskId}:${failure.startedAtIso}`;
        yield* threads.sendToThread({
          projectId: shell.projectId,
          commandId: CommandId.make(id),
          threadId: target,
          messageId: MessageId.make(id),
          text: formatScheduledRunFailure(failure, link),
          attachments: [],
          mode: "auto",
          createdBy: "system",
          creationSource: "server",
        });
      },
      (effect, failure) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not report a failed scheduled run", {
              taskId: failure.taskId,
              cause,
            }),
          ),
        ),
    );
    return ScheduledRunAlerts.of({ notifyFailure, notifySweepAttention });
  }),
);
