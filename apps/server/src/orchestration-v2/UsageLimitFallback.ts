import {
  ALWAYS_DENIED_FALLBACK_MODELS,
  CommandId,
  HOME_TOT_ID,
  MessageId,
  parseTotLaunchedThreadId,
  type ModelSelection,
  type RunId,
  type ServerSettings,
  type ThreadId,
  type TotId,
} from "@t3tools/contracts";
import { latestRootProviderFailure } from "@t3tools/shared/orchestrationV2ThreadError";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

/** Ids of the one retry a run gets; a run started by one never gets another. */
const USAGE_LIMIT_FALLBACK_ID_PREFIX = "usage-limit-fallback:";

const normalized = (model: string) => model.trim().toLowerCase();

const isDeniedFallbackModel = (model: string, denied: ReadonlyArray<string>) => {
  const id = normalized(model);
  return [...ALWAYS_DENIED_FALLBACK_MODELS, ...denied].some((entry) => normalized(entry) === id);
};

/** A Tot's own list, even an empty one, replaces the environment's. */
export const fallbackCandidates = (
  settings: Pick<ServerSettings, "usageLimitFallbackModels" | "tots">,
  totId: TotId | null,
): ReadonlyArray<ModelSelection> =>
  (totId === null ? undefined : settings.tots.find((tot) => tot.id === totId))
    ?.usageLimitFallbackModels ?? settings.usageLimitFallbackModels;

export const chooseUsageLimitFallback = (input: {
  readonly candidates: ReadonlyArray<ModelSelection>;
  readonly denied: ReadonlyArray<string>;
  readonly failed: ModelSelection;
}): ModelSelection | null =>
  input.candidates.find(
    (candidate) =>
      !isDeniedFallbackModel(candidate.model, input.denied) &&
      !(
        candidate.instanceId === input.failed.instanceId &&
        normalized(candidate.model) === normalized(input.failed.model)
      ),
  ) ?? null;

export interface UsageLimitFallbackRetry {
  /** The user message of the retry run. */
  readonly messageId: MessageId;
  readonly model: ModelSelection;
}

export interface UsageLimitFallbackInput {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  /** Whose fallback list applies; null uses the environment's. */
  readonly totId: TotId | null;
}

/** Without the live layer (tests, tools that build only part of the server) nothing is retried. */
export class UsageLimitFallback extends Context.Reference<{
  readonly retry: (input: UsageLimitFallbackInput) => Effect.Effect<UsageLimitFallbackRetry | null>;
}>("t3/orchestration-v2/UsageLimitFallback", {
  defaultValue: () => ({ retry: () => Effect.succeed(null) }),
}) {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;

  const retry = Effect.fn("UsageLimitFallback.retry")(
    function* (input: UsageLimitFallbackInput) {
      const shell = yield* threads.getThreadShell(input.threadId);
      if (shell === null || shell.deletedAt != null || shell.archivedAt !== null) return null;
      const { runs, turnItems } = yield* threads.getThreadRecords(
        input.threadId,
        ["runs", "turnItems"],
        { runIds: [input.runId], turnItemRunIds: [input.runId], turnItemTypes: ["error"] },
      );
      const run = runs.find((candidate) => candidate.id === input.runId);
      if (run === undefined || run.status !== "failed") return null;
      if (run.userMessageId.startsWith(USAGE_LIMIT_FALLBACK_ID_PREFIX)) return null;
      const failure = latestRootProviderFailure(run, turnItems);
      if (failure?.class !== "usage_limit") return null;
      const settings = yield* settingsService.getSettings;
      const model = chooseUsageLimitFallback({
        candidates: fallbackCandidates(settings, input.totId),
        denied: settings.usageLimitFallbackDeniedModels,
        failed: run.modelSelection,
      });
      if (model === null) return null;
      // Fixed ids per failed run: a replay is a no-op, so the retry can never fire twice.
      const id = `${USAGE_LIMIT_FALLBACK_ID_PREFIX}${input.threadId}:${run.id}`;
      const messageId = MessageId.make(id);
      yield* threads.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(id),
        threadId: input.threadId,
        messageId,
        manualContinuationOfRunId: run.id,
        modelSelection: model,
        text: "",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      });
      yield* threads
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`${id}:notice`),
          threadId: input.threadId,
          messageId: MessageId.make(`${id}:notice`),
          text: `${run.modelSelection.model} hit a usage limit, so this run was retried once on ${model.model}.`,
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          systemNotice: true,
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("usage-limit-fallback.notice-failed", {
              threadId: input.threadId,
              cause,
            }),
          ),
        );
      return { messageId, model };
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("usage-limit-fallback.retry-failed", {
            threadId: input.threadId,
            runId: input.runId,
            cause,
          }).pipe(Effect.as(null)),
        ),
      ),
  );
  return UsageLimitFallback.of({ retry });
});

export const layer = Layer.effect(UsageLimitFallback, make);

/**
 * Retries failed runs in threads a Tot launched. Scheduled runs are retried by
 * ScheduledTaskService, which also has to know how the retry ended.
 */
export const workerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const fallback = yield* UsageLimitFallback;
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        if (event.type !== "run.updated" || event.payload.status !== "failed") return Effect.void;
        const totId = parseTotLaunchedThreadId(event.threadId);
        if (totId === null) return Effect.void;
        return fallback
          .retry({ threadId: event.threadId, runId: event.payload.id, totId })
          .pipe(Effect.asVoid);
      }),
    );
  }),
);

/** Home stands in for a task no Tot owns, or whose Tot is off. */
export const failureNoticeTotThread = (
  settings: Pick<ServerSettings, "tots">,
  ownerTotId: TotId | null,
): ThreadId | null =>
  (ownerTotId === null
    ? null
    : (settings.tots.find((tot) => tot.id === ownerTotId)?.threadId ?? null)) ??
  settings.tots.find((tot) => tot.id === HOME_TOT_ID)?.threadId ??
  null;
