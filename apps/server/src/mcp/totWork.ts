import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as TotWatchService from "../tots/TotWatchService.ts";
import * as TotWorkService from "../tots/TotWorkService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { readTotCaller } from "./totCaller.ts";

/**
 * The calling Tot's objective for work it is about to start, checked before anything starts so an
 * objective past its retry cap refuses the launch. Undefined when there is nothing to record.
 */
export const checkObjective = Effect.fn("mcp.checkObjective")(function* (
  objective: string | undefined,
) {
  if (objective === undefined) return undefined;
  const tot = yield* readTotCaller();
  // The work list lives with the Tot; a linked Tot keeps its own.
  if (Option.isNone(tot) || tot.value.via !== "local") return undefined;
  const work = yield* Effect.serviceOption(TotWorkService.TotWorkService);
  if (Option.isNone(work)) return undefined;
  return yield* work.value
    .check(tot.value.totId, objective)
    .pipe(
      Effect.mapError(
        (error) => new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
      ),
    );
});

/** Records the work that started; the work itself already happened, so a failure only logs. */
export const recordAttempt = Effect.fn("mcp.recordAttempt")(function* (
  target: TotWorkService.TotObjectiveTarget | undefined,
  attempt: TotWorkService.TotNewAttempt,
) {
  if (target === undefined) return {};
  const work = yield* Effect.serviceOption(TotWorkService.TotWorkService);
  if (Option.isNone(work)) return {};
  const recorded = yield* work.value.attach(target, attempt).pipe(
    Effect.map((objective) => ({ objectiveId: objective.id })),
    Effect.catch((error) =>
      Effect.logWarning("Could not record Tot work", error).pipe(Effect.as({})),
    ),
  );
  // A fast run can end before the attempt exists; look once now so its outcome is not missed.
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const watch = yield* Effect.serviceOption(TotWatchService.TotWatchService);
  if (attempt.environmentId === scope.environmentId && Option.isSome(watch)) {
    yield* watch.value.observe(attempt.threadId);
  }
  return recorded;
});

/** After a linked environment ran the work: the objective `checkObjective` already allowed. */
export const forwardedObjectiveTarget = Effect.fn("mcp.forwardedObjectiveTarget")(function* (
  objective: string | undefined,
) {
  if (objective === undefined) return undefined;
  const tot = yield* readTotCaller();
  if (Option.isNone(tot) || tot.value.via !== "local") return undefined;
  return TotWorkService.objectiveTargetOf(tot.value.totId, objective);
});
