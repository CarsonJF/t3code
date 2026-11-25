import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Precheck from "./precheck.ts";

it("passes on exit 0 and explains any other exit with the last line it printed", () => {
  expect(
    Precheck.describePrecheckExit({ code: 0, timedOut: false, stdout: "", stderr: "" }),
  ).toEqual({ pass: true, detail: null });
  expect(
    Precheck.describePrecheckExit({
      code: 1,
      timedOut: false,
      stdout: "checking\nno new commits\n",
      stderr: "",
    }),
  ).toEqual({ pass: false, detail: "Exited 1: no new commits" });
  expect(
    Precheck.describePrecheckExit({ code: null, timedOut: true, stdout: "", stderr: "" }),
  ).toEqual({ pass: false, detail: "Timed out after 60 s." });
});

const projectLayer = (workspaceRoot: string | null) =>
  Layer.mock(ProjectService.ProjectService)({
    getById: () =>
      Effect.succeed(
        workspaceRoot === null ? Option.none() : Option.some({ workspaceRoot } as never),
      ),
  });

const runIn = (workspaceRoot: string | null, command: string) =>
  Effect.gen(function* () {
    const run = yield* Precheck.ScheduledTaskPrecheckRunner;
    return yield* run({ command, projectId: ProjectId.make("project") });
  }).pipe(
    Effect.provide(
      Precheck.layer.pipe(
        Layer.provide(projectLayer(workspaceRoot)),
        Layer.provide(ProcessRunner.layer),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "runs the command in the project folder through the shell",
  () =>
    Effect.gen(function* () {
      const root = process.cwd();
      expect(yield* runIn(root, `test "$(pwd)" = "${root}"`)).toEqual({ pass: true, detail: null });
      expect(yield* runIn(root, "echo nothing to do >&2; exit 3")).toEqual({
        pass: false,
        detail: "Exited 3: nothing to do",
      });
      expect(yield* runIn(null, "true")).toEqual({
        pass: false,
        detail: "The task's project no longer exists.",
      });
    }),
);

it.effect("skips the run when no runner is provided", () =>
  Effect.gen(function* () {
    const run = yield* Precheck.ScheduledTaskPrecheckRunner;
    expect((yield* run({ command: "true", projectId: ProjectId.make("p") })).pass).toBe(false);
  }),
);
