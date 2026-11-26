import {
  ALWAYS_DENIED_FALLBACK_MODELS,
  CommandId,
  HOME_TOT_ID,
  MessageId,
  parseTotLaunchedThreadId,
  type ModelSelection,
  isProviderAvailable,
  type RunId,
  type ServerProvider,
  type ServerSettings,
  type ThreadId,
  type TotId,
  UsageLimitAccountRetryError,
  type UsageLimitAccountRetryInput,
} from "@t3tools/contracts";
import { latestRootProviderFailure } from "@t3tools/shared/orchestrationV2ThreadError";
import { otherProviderAccounts, providerAccountLabel } from "@t3tools/shared/usageLimits";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

/** Ids of the one retry a run gets; a run started by one never gets another. */
const USAGE_LIMIT_FALLBACK_ID_PREFIX = "usage-limit-fallback:";
/** Ids of a retry the user asked for on another account; the user chose, so none follows it. */
const ACCOUNT_RETRY_ID_PREFIX = "usage-limit-account:";

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

const usableAccount = (providers: ReadonlyArray<ServerProvider>, selection: ModelSelection) =>
  providers.some(
    (provider) =>
      provider.instanceId === selection.instanceId &&
      provider.enabled &&
      isProviderAvailable(provider) &&
      provider.auth.status !== "unauthenticated",
  );

/**
 * The first usable candidate, preferring the same model on another account of the failed
 * provider. Without `providers` (nothing known about this machine's accounts) it is list order.
 */
export const chooseUsageLimitFallback = (input: {
  readonly candidates: ReadonlyArray<ModelSelection>;
  readonly denied: ReadonlyArray<string>;
  readonly failed: ModelSelection;
  readonly providers?: ReadonlyArray<ServerProvider>;
}): ModelSelection | null => {
  const { providers } = input;
  const usable = input.candidates.filter(
    (candidate) =>
      !isDeniedFallbackModel(candidate.model, input.denied) &&
      !(
        candidate.instanceId === input.failed.instanceId &&
        normalized(candidate.model) === normalized(input.failed.model)
      ) &&
      (providers === undefined || usableAccount(providers, candidate)),
  );
  if (providers === undefined) return usable[0] ?? null;
  const accounts = new Set(
    otherProviderAccounts(providers, input.failed.instanceId).map((account) => account.instanceId),
  );
  return (
    usable.find(
      (candidate) =>
        accounts.has(candidate.instanceId) &&
        normalized(candidate.model) === normalized(input.failed.model),
    ) ??
    usable[0] ??
    null
  );
};

const accountLabel = (providers: ReadonlyArray<ServerProvider>, selection: ModelSelection) => {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return provider === undefined ? selection.instanceId : providerAccountLabel(provider);
};

const fallbackNotice = (
  failed: ModelSelection,
  model: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
) =>
  failed.instanceId === model.instanceId
    ? `${failed.model} hit a usage limit, so this run was retried once on ${model.model}.`
    : `${failed.model} (account: ${accountLabel(providers, failed)}) hit a usage limit, so this run was retried once on ${model.model} (account: ${accountLabel(providers, model)}).`;

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

const accountRetryFailure = (message: string) => new UsageLimitAccountRetryError({ message });

export interface UsageLimitFallbackService {
  readonly retry: (input: UsageLimitFallbackInput) => Effect.Effect<UsageLimitFallbackRetry | null>;
  /**
   * The user's choice: the thread's latest run, stopped on a usage limit, runs again on the same
   * model with another account, which the thread then keeps.
   */
  readonly retryOnAccount: (
    input: UsageLimitAccountRetryInput,
  ) => Effect.Effect<UsageLimitFallbackRetry, UsageLimitAccountRetryError>;
}

/** Without the live layer (tests, tools that build only part of the server) nothing is retried. */
export class UsageLimitFallback extends Context.Reference<UsageLimitFallbackService>(
  "t3/orchestration-v2/UsageLimitFallback",
  {
    defaultValue: () => ({
      retry: () => Effect.succeed(null),
      retryOnAccount: () =>
        Effect.fail(accountRetryFailure("This server cannot retry runs on another account.")),
    }),
  },
) {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  const providers = registry._tag === "Some" ? registry.value.getProviders : undefined;

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
      if (
        run.userMessageId.startsWith(USAGE_LIMIT_FALLBACK_ID_PREFIX) ||
        run.userMessageId.startsWith(ACCOUNT_RETRY_ID_PREFIX)
      )
        return null;
      const failure = latestRootProviderFailure(run, turnItems);
      if (failure?.class !== "usage_limit") return null;
      const settings = yield* settingsService.getSettings;
      const known = providers === undefined ? undefined : yield* providers;
      const model = chooseUsageLimitFallback({
        candidates: fallbackCandidates(settings, input.totId),
        denied: settings.usageLimitFallbackDeniedModels,
        failed: run.modelSelection,
        ...(known === undefined ? {} : { providers: known }),
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
          text: fallbackNotice(run.modelSelection, model, known ?? []),
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

  const retryOnAccount = Effect.fn("UsageLimitFallback.retryOnAccount")(function* (
    input: UsageLimitAccountRetryInput,
  ) {
    const shell = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null || shell.deletedAt != null) {
      return yield* accountRetryFailure("That thread was not found.");
    }
    if (shell.latestRunId !== input.runId) {
      return yield* accountRetryFailure("The thread has moved on since that run.");
    }
    const { runs, turnItems } = yield* threads
      .getThreadRecords(input.threadId, ["runs", "turnItems"], {
        runIds: [input.runId],
        turnItemRunIds: [input.runId],
        turnItemTypes: ["error"],
      })
      .pipe(Effect.mapError(() => accountRetryFailure("That run could not be read.")));
    const run = runs.find((candidate) => candidate.id === input.runId);
    if (
      run === undefined ||
      run.status !== "failed" ||
      latestRootProviderFailure(run, turnItems)?.class !== "usage_limit"
    ) {
      return yield* accountRetryFailure(
        "Only a run that stopped on a usage limit can be retried on another account.",
      );
    }
    const known = providers === undefined ? [] : yield* providers;
    const account = otherProviderAccounts(known, run.modelSelection.instanceId).find(
      (candidate) => candidate.instanceId === input.instanceId,
    );
    if (account === undefined) {
      return yield* accountRetryFailure(
        "That is not another signed-in account of this run's provider here.",
      );
    }
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => accountRetryFailure("The server settings could not be read.")),
    );
    if (isDeniedFallbackModel(run.modelSelection.model, settings.usageLimitFallbackDeniedModels)) {
      return yield* accountRetryFailure(`${run.modelSelection.model} is never used for a retry.`);
    }
    const model: ModelSelection = { ...run.modelSelection, instanceId: input.instanceId };
    // Fixed per run and account, so a double click starts one retry.
    const id = `${ACCOUNT_RETRY_ID_PREFIX}${input.threadId}:${run.id}:${input.instanceId}`;
    const messageId = MessageId.make(id);
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(id),
        threadId: input.threadId,
        messageId,
        manualContinuationOfRunId: run.id,
        modelSelection: model,
        text: "",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(Effect.mapError(() => accountRetryFailure("The retry could not be started.")));
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`${id}:notice`),
        threadId: input.threadId,
        messageId: MessageId.make(`${id}:notice`),
        text: `${run.modelSelection.model} (account: ${accountLabel(known, run.modelSelection)}) hit a usage limit, so this run was retried on ${model.model} (account: ${account.label}), as you asked.`,
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        systemNotice: true,
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("usage-limit-account-retry.notice-failed", {
            threadId: input.threadId,
            cause,
          }),
        ),
      );
    return { messageId, model };
  });

  return UsageLimitFallback.of({ retry, retryOnAccount });
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
