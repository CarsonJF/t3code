import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  RunId,
  RuntimeRequestId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationV2UserInputQuestion } from "./orchestrationV2.ts";
import { ProviderRequestKind, ProviderUserInputAnswers } from "./providerPolicy.ts";
import { ProviderAccountChoice } from "./providerUsageLimits.ts";
import { TotId } from "./tots.ts";

export const NeedsYouItemKind = Schema.Literals([
  "approval",
  "question",
  "failed_run",
  "stopped_run",
  "scheduled_failure",
  "companion",
  "sweep_attention",
]);
export type NeedsYouItemKind = typeof NeedsYouItemKind.Type;

/** One thing waiting on the user. `key` is stable for as long as the thing waits. */
export const NeedsYouItem = Schema.Struct({
  key: TrimmedNonEmptyString,
  kind: NeedsYouItemKind,
  threadId: Schema.NullOr(ThreadId),
  /** The thread's title, or the scheduled task's. */
  title: Schema.String,
  summary: Schema.String,
  /** When it started waiting. */
  at: IsoDateTime,
  /** The Tot the thread or scheduled task belongs to. */
  totId: Schema.NullOr(TotId),
  requestId: Schema.optional(RuntimeRequestId),
  approvalKind: Schema.optional(ProviderRequestKind),
  /** Absent when the question can only be answered in its thread, such as a secret. */
  questions: Schema.optional(Schema.Array(OrchestrationV2UserInputQuestion)),
  scheduledTaskId: Schema.optional(ScheduledTaskId),
  /** The failed run, on a run that stopped on a usage limit. */
  runId: Schema.optional(RunId),
  /** Other accounts of that run's provider it can be retried on, in this environment. */
  retryAccounts: Schema.optional(Schema.Array(ProviderAccountChoice)),
  /** Present only on hidden items: when a snooze ends, or null when dismissed. */
  hiddenUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  /** A thread link agents can pass on; clients build their own. */
  link: Schema.optional(Schema.String),
  /** Set on `companion` items: answered through `companions.respond`, not a thread. */
  companion: Schema.optional(
    Schema.Struct({
      companionId: Schema.String,
      name: Schema.String,
      needsYouId: Schema.String,
      channel: Schema.String,
      kind: Schema.Literals(["question", "approval"]),
      options: Schema.Array(Schema.String),
    }),
  ),
});
export type NeedsYouItem = typeof NeedsYouItem.Type;

export const NeedsYouEnvironment = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  /** The environment that answered the list, as opposed to one it is linked to. */
  local: Schema.Boolean,
  /** Why a linked environment could not be read; its items are then empty. */
  error: Schema.NullOr(Schema.String),
  tots: Schema.Array(Schema.Struct({ id: TotId, name: Schema.String })),
  items: Schema.Array(NeedsYouItem),
});
export type NeedsYouEnvironment = typeof NeedsYouEnvironment.Type;

export const NeedsYouInbox = Schema.Struct({
  environments: Schema.Array(NeedsYouEnvironment),
});
export type NeedsYouInbox = typeof NeedsYouInbox.Type;

export const NeedsYouListInput = Schema.Struct({
  /** Also list dismissed and snoozed items, each with `hiddenUntil`. */
  includeHidden: Schema.optional(Schema.Boolean),
  /** Also ask every linked environment. Defaults to true. */
  linked: Schema.optional(Schema.Boolean),
});
export type NeedsYouListInput = typeof NeedsYouListInput.Type;

export const NeedsYouItemRef = Schema.Struct({
  environmentId: EnvironmentId,
  key: TrimmedNonEmptyString,
});
export type NeedsYouItemRef = typeof NeedsYouItemRef.Type;

export const NeedsYouHideInput = Schema.Struct({
  ...NeedsYouItemRef.fields,
  /** Null dismisses until the item goes away; a time snoozes until then. */
  until: Schema.NullOr(IsoDateTime),
});
export type NeedsYouHideInput = typeof NeedsYouHideInput.Type;

export const NeedsYouSuggestResult = Schema.Struct({
  suggestions: Schema.Array(
    Schema.Struct({ questionId: Schema.String, answers: Schema.Array(Schema.String) }),
  ),
});
export type NeedsYouSuggestResult = typeof NeedsYouSuggestResult.Type;

/** Answers a request in a linked environment this client has no connection to. */
export const NeedsYouRespondInput = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: RuntimeRequestId,
  answers: ProviderUserInputAnswers,
});
export type NeedsYouRespondInput = typeof NeedsYouRespondInput.Type;

export class NeedsYouError extends Schema.TaggedError<NeedsYouError>()("NeedsYouError", {
  message: Schema.String,
}) {}
