import { type ProjectId, SCHEDULED_TASK_PRECHECK_TIMEOUT_MS } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";

export interface PrecheckInput {
  readonly command: string;
  readonly projectId: ProjectId;
}

/** `pass: false` skips the run; `detail` says why, for the task's last skip. */
export interface PrecheckResult {
  readonly pass: boolean;
  readonly detail: string | null;
}

const DETAIL_MAX_LENGTH = 300;

/** Runs a scheduled task's precheck. Without a real runner, fail closed: the run is skipped. */
export class ScheduledTaskPrecheckRunner extends Context.Reference<
  (input: PrecheckInput) => Effect.Effect<PrecheckResult>
>("t3/scheduledTasks/ScheduledTaskPrecheckRunner", {
  defaultValue: () => () =>
    Effect.succeed({ pass: false, detail: "No precheck runner is available here." }),
}) {}

const lastLine = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line !== "") ?? "";

export const describePrecheckExit = (output: {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}): PrecheckResult => {
  if (output.timedOut) {
    return {
      pass: false,
      detail: `Timed out after ${SCHEDULED_TASK_PRECHECK_TIMEOUT_MS / 1000} s.`,
    };
  }
  if (output.code === 0) return { pass: true, detail: null };
  const said = lastLine(output.stderr) || lastLine(output.stdout);
  const detail = `Exited ${output.code ?? "without a code"}${said === "" ? "." : `: ${said}`}`;
  return { pass: false, detail: detail.slice(0, DETAIL_MAX_LENGTH) };
};

export const layer = Layer.effect(
  ScheduledTaskPrecheckRunner,
  Effect.gen(function* () {
    const projects = yield* ProjectService.ProjectService;
    const runner = yield* ProcessRunner.ProcessRunner;
    const platform = yield* HostProcess.Platform;
    return (input: PrecheckInput) =>
      Effect.gen(function* () {
        const project = yield* projects.getById(input.projectId);
        if (Option.isNone(project)) {
          return { pass: false, detail: "The task's project no longer exists." };
        }
        const shell =
          platform === "win32"
            ? { command: "cmd.exe", args: ["/d", "/s", "/c", input.command] }
            : { command: "/bin/sh", args: ["-c", input.command] };
        const output = yield* runner.run({
          ...shell,
          cwd: project.value.workspaceRoot,
          timeout: SCHEDULED_TASK_PRECHECK_TIMEOUT_MS,
          timeoutBehavior: "timedOutResult",
          maxOutputBytes: 16 * 1024,
          outputMode: "truncate",
        });
        return describePrecheckExit({ ...output, code: output.code ?? null });
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            pass: false,
            detail: `The precheck could not run: ${error.message}`.slice(0, DETAIL_MAX_LENGTH),
          }),
        ),
        Effect.withSpan("ScheduledTaskPrecheckRunner.run"),
      );
  }),
);
