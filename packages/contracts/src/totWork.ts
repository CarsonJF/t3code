/**
 * A Tot's work list: the objectives it launched work for, each with the threads and runs that
 * tried it. The host derives each status from those runs; a Tot only closes or resets one.
 */
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { TotId } from "./tots.ts";

export const TotObjectiveId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^obj-[a-z0-9]{6,32}$/),
).pipe(Schema.brand("TotObjectiveId"));
export type TotObjectiveId = typeof TotObjectiveId.Type;

/** A short goal, or an existing objective's id. */
export const TotObjectiveRef = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

/** The `objective` a Tot passes when it starts work. */
export const TotObjectiveRefInput = TotObjectiveRef.annotate({
  description: "Tots: the goal, or its objective id. Groups attempts in t3_tot_work.",
});

export const TOT_OBJECTIVE_STATUSES = [
  "planned",
  "working",
  "waiting",
  "needs_you",
  "done",
  "failed",
  "cancelled",
] as const;
export const TotObjectiveStatus = Schema.Literals(TOT_OBJECTIVE_STATUSES);
export type TotObjectiveStatus = typeof TotObjectiveStatus.Type;

export const TotObjectiveAttemptStatus = Schema.Literals([
  "working",
  "waiting",
  "needs_you",
  "done",
  "failed",
  "stopped",
]);
export type TotObjectiveAttemptStatus = typeof TotObjectiveAttemptStatus.Type;

export const DEFAULT_TOT_OBJECTIVE_RETRY_CAP = 3;
/** 0 turns the cap off. */
export const TotObjectiveRetryCap = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 }));

export const TotObjectiveAttempt = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["launch", "delegate", "send"]),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  taskId: Schema.NullOr(Schema.String),
  status: TotObjectiveAttemptStatus,
  /** The end of the worker's last message once the attempt ended. Untrusted thread text. */
  outcome: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
});
export type TotObjectiveAttempt = typeof TotObjectiveAttempt.Type;

export const TotObjective = Schema.Struct({
  id: TotObjectiveId,
  totId: TotId,
  title: Schema.String,
  status: TotObjectiveStatus,
  /** Failed or stopped attempts since the last reset. */
  failedAttempts: Schema.Int,
  /** The cap that applied when this was read; 0 is off. */
  retryCap: Schema.Int,
  /** Oldest first. */
  attempts: Schema.Array(TotObjectiveAttempt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TotObjective = typeof TotObjective.Type;

export const TotWorkList = Schema.Struct({
  objectives: Schema.Array(TotObjective),
});
export type TotWorkList = typeof TotWorkList.Type;

export const TotWorkSubscribeInput = Schema.Struct({ id: TotId });
export type TotWorkSubscribeInput = typeof TotWorkSubscribeInput.Type;

export const TotWorkAction = Schema.Literals(["done", "cancelled", "reset"]);
export type TotWorkAction = typeof TotWorkAction.Type;

export const TotWorkUpdateInput = Schema.Struct({
  id: TotId,
  objectiveId: TotObjectiveId,
  action: TotWorkAction,
});
export type TotWorkUpdateInput = typeof TotWorkUpdateInput.Type;
