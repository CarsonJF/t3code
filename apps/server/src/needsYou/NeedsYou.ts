import {
  ALWAYS_DENIED_FALLBACK_MODELS,
  CommandId,
  type EnvironmentId,
  type NeedsYouEnvironment,
  NeedsYouError,
  type NeedsYouHideInput,
  NeedsYouInbox,
  type NeedsYouItem,
  type NeedsYouItemRef,
  type NeedsYouListInput,
  type NeedsYouRespondInput,
  type NeedsYouSuggestResult,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import { resolveReplySuggestionModelSelection } from "@t3tools/shared/serverSettings";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as TotService from "../tots/TotService.ts";
import {
  applyHidden,
  cleanSuggestions,
  type HiddenEntry,
  newestFirst,
  pruneHidden,
  replySuggestionPrompt,
  requestItems,
  runItem,
  scheduledItem,
} from "./needsYouItems.ts";

/**
 * One inbox of what waits on the user: pending approvals and questions, failed or stopped runs
 * they have not opened, and failed scheduled runs, here and in every linked environment.
 * `changes` is the "inbox changed" signal clients and push notifiers follow.
 */
export class NeedsYou extends Context.Service<
  NeedsYou,
  {
    readonly list: (input: NeedsYouListInput) => Effect.Effect<NeedsYouInbox, NeedsYouError>;
    /** The inbox now, then again whenever it changes. */
    readonly changes: (input: NeedsYouListInput) => Stream.Stream<NeedsYouInbox>;
    readonly hide: (input: NeedsYouHideInput) => Effect.Effect<void, NeedsYouError>;
    readonly restore: (input: NeedsYouItemRef) => Effect.Effect<void, NeedsYouError>;
    /** Short replies to a question's free-text parts; never sent by themselves. */
    readonly suggest: (
      input: NeedsYouItemRef,
    ) => Effect.Effect<NeedsYouSuggestResult, NeedsYouError>;
    /** Answers a question in this or a linked environment through its usual respond path. */
    readonly respond: (input: NeedsYouRespondInput) => Effect.Effect<void, NeedsYouError>;
  }
>()("t3/needsYou/NeedsYou") {}

const HIDDEN_FILE = "needs-you-hidden.json";
const PEER_TIMEOUT = "10 seconds";
// Linked environments send no events here, and snoozes lapse on their own.
const POLL_INTERVAL = "60 seconds";
const SUGGESTION_CACHE_LIMIT = 200;
// The peer narrows this to the link's own access.
const PEER_LIMITS = { runtimeMode: "full-access", interactionMode: "default" } as const;

const HiddenFile = Schema.Array(
  Schema.Struct({
    environmentId: Schema.String,
    key: Schema.String,
    until: Schema.NullOr(Schema.String),
  }),
);
const decodeHidden = Schema.decodeUnknownOption(Schema.fromJsonString(HiddenFile));

const fail = (message: string) => new NeedsYouError({ message });

const touchesInbox = (event: OrchestrationV2DomainEvent) => {
  switch (event.type) {
    case "run.updated":
    case "runtime-request.updated":
      return true;
    case "turn-item.updated":
      return (
        event.payload.type === "user_input_request" || event.payload.type === "approval_request"
      );
    default:
      return event.type.startsWith("thread.") && !event.type.startsWith("thread.pull-request");
  }
};

const itemId = (environmentId: string, key: string) => `${environmentId}\n${key}`;

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const tots = yield* TotService.TotService;
  const scheduled = yield* ScheduledTasks.ScheduledTaskService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const peerLinks = yield* PeerLinks.PeerLinks;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;

  const hiddenPath = path.join(config.stateDir, HIDDEN_FILE);
  const hiddenLock = yield* Semaphore.make(1);
  const hiddenRef = yield* Ref.make<ReadonlyArray<HiddenEntry>>(
    yield* fileSystem.readFileString(hiddenPath).pipe(
      Effect.map((text) =>
        Option.getOrElse(decodeHidden(text), (): ReadonlyArray<HiddenEntry> => []),
      ),
      Effect.orElseSucceed(() => []),
    ),
  );
  const hiddenChanged = yield* PubSub.unbounded<void>();
  /** Items as last listed, so a suggestion can be asked for by key, linked ones included. */
  const lastListed = new Map<string, NeedsYouItem>();
  const suggestions = new Map<string, NeedsYouSuggestResult>();

  const saveHidden = (next: ReadonlyArray<HiddenEntry>) =>
    Ref.set(hiddenRef, next).pipe(
      Effect.andThen(
        writeFileStringAtomically({ filePath: hiddenPath, contents: `${JSON.stringify(next)}\n` }),
      ),
      Effect.mapError(() => fail("Could not save what Needs you hides.")),
    );

  const localEnvironment = Effect.fn("NeedsYou.localEnvironment")(function* () {
    const descriptor = yield* environment.getDescriptor;
    const snapshot = yield* threads.getShellSnapshot({ unsettledOnly: true });
    const live = snapshot.threads.filter((shell) => shell.deletedAt === null);
    const requests = yield* Effect.forEach(
      live.filter((shell) => shell.pendingRuntimeRequest !== null),
      (shell) =>
        threads
          .getProjectThreadRecords(
            { projectId: shell.projectId, threadId: shell.id },
            ["runtimeRequests", "turnItems"],
            { turnItemTypes: ["user_input_request", "approval_request"] },
          )
          .pipe(
            Effect.map((records) =>
              requestItems({
                shell,
                requests: records.runtimeRequests,
                turnItems: records.turnItems,
              }),
            ),
            // A thread deleted between the two reads has nothing waiting.
            Effect.orElseSucceed(() => []),
          ),
      { concurrency: 4 },
    );
    const runs = live.flatMap((shell) => {
      const item = shell.pendingRuntimeRequest === null ? runItem(shell) : null;
      return item === null ? [] : [item];
    });
    const tasks = yield* scheduled.list().pipe(
      Effect.map((result) => result.tasks),
      Effect.orElseSucceed(() => []),
    );
    const failedTasks = tasks.flatMap((task) => {
      const item = scheduledItem(task);
      return item === null ? [] : [item];
    });
    const totList = yield* tots.list;
    return {
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      local: true,
      error: null,
      tots: totList.map((tot) => ({ id: tot.id, name: tot.name })),
      items: newestFirst([...requests.flat(), ...runs, ...failedTasks]),
    } satisfies NeedsYouEnvironment;
  });

  const linkedEnvironments = Effect.fn("NeedsYou.linkedEnvironments")(function* () {
    if (!(yield* peerLinks.enabled)) return [];
    const names = yield* peerLinks.names.pipe(Effect.orElseSucceed(() => []));
    return yield* Effect.forEach(
      names,
      (name) =>
        peers
          .call({
            environmentId: name.environmentId,
            tool: "t3_needs_you",
            arguments: { linked: false },
            limits: PEER_LIMITS,
            success: NeedsYouInbox,
          })
          .pipe(
            Effect.timeout(PEER_TIMEOUT),
            Effect.map((inbox): NeedsYouEnvironment => {
              const there = inbox.environments.find(
                (candidate) => candidate.environmentId === name.environmentId,
              );
              return {
                environmentId: name.environmentId,
                label: name.label,
                local: false,
                error: null,
                tots: there?.tots ?? [],
                items: there?.items ?? [],
              };
            }),
            Effect.catch((error) =>
              Effect.succeed<NeedsYouEnvironment>({
                environmentId: name.environmentId,
                label: name.label,
                local: false,
                error:
                  "message" in error && typeof error.message === "string"
                    ? error.message
                    : "It did not answer.",
                tots: [],
                items: [],
              }),
            ),
          ),
      { concurrency: "unbounded" },
    );
  });

  const list: NeedsYou["Service"]["list"] = Effect.fn("NeedsYou.list")(
    function* (input) {
      const local = yield* localEnvironment();
      const linked = input.linked === false ? [] : yield* linkedEnvironments();
      const environments = [local, ...linked];
      const now = Date.now();
      const hidden = yield* Ref.get(hiddenRef);
      const read = new Map(
        environments
          .filter((entry) => entry.error === null)
          .map((entry) => [entry.environmentId, new Set(entry.items.map((item) => item.key))]),
      );
      // Only a full read knows which linked items are gone.
      const pruned = pruneHidden(
        hidden,
        input.linked === false
          ? new Map([...read].filter(([id]) => id === local.environmentId))
          : read,
        now,
      );
      if (pruned.length !== hidden.length) {
        yield* hiddenLock.withPermits(1)(saveHidden(pruned)).pipe(Effect.ignore);
      }
      for (const entry of environments) {
        for (const item of entry.items) lastListed.set(itemId(entry.environmentId, item.key), item);
      }
      return {
        environments: environments.map((entry) => ({
          ...entry,
          items: applyHidden(
            entry.environmentId,
            entry.items,
            pruned,
            now,
            input.includeHidden === true,
          ),
        })),
      };
    },
    Effect.mapError((cause) =>
      cause instanceof NeedsYouError ? cause : fail("Needs you could not be read here."),
    ),
  );

  const changes: NeedsYou["Service"]["changes"] = (input) => {
    const triggers = Stream.mergeAll(
      [
        Stream.succeed(undefined),
        threads.streamDomainEvents.pipe(Stream.filter(touchesInbox), Stream.ignoreCause),
        scheduled.subscribeList().pipe(Stream.ignoreCause),
        Stream.fromPubSub(hiddenChanged),
        Stream.tick(POLL_INTERVAL),
      ],
      { concurrency: "unbounded" },
    );
    return triggers.pipe(
      Stream.debounce("300 millis"),
      // A failed read keeps the last inbox; the next trigger tries again.
      Stream.mapEffect(() => list(input).pipe(Effect.option)),
      Stream.filter(Option.isSome),
      Stream.map((inbox) => inbox.value),
      Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
    );
  };

  const changeHidden = (
    update: (current: ReadonlyArray<HiddenEntry>) => ReadonlyArray<HiddenEntry>,
  ) =>
    hiddenLock
      .withPermits(1)(
        Ref.get(hiddenRef).pipe(Effect.flatMap((current) => saveHidden(update(current)))),
      )
      .pipe(Effect.andThen(PubSub.publish(hiddenChanged, undefined)), Effect.asVoid);

  const hide: NeedsYou["Service"]["hide"] = Effect.fn("NeedsYou.hide")(function* (input) {
    yield* changeHidden((current) => [
      ...current.filter(
        (entry) => entry.environmentId !== input.environmentId || entry.key !== input.key,
      ),
      { environmentId: input.environmentId, key: input.key, until: input.until },
    ]);
  });

  const restore: NeedsYou["Service"]["restore"] = Effect.fn("NeedsYou.restore")(function* (input) {
    yield* changeHidden((current) =>
      current.filter(
        (entry) => entry.environmentId !== input.environmentId || entry.key !== input.key,
      ),
    );
  });

  const suggest: NeedsYou["Service"]["suggest"] = Effect.fn("NeedsYou.suggest")(
    function* (input) {
      const id = itemId(input.environmentId, input.key);
      const cached = suggestions.get(id);
      if (cached !== undefined) return cached;
      if (!lastListed.has(id)) yield* list({ includeHidden: true });
      const item = lastListed.get(id);
      if (item === undefined || item.kind !== "question" || item.questions === undefined) {
        return yield* fail("That question is no longer waiting.");
      }
      // Options the agent offered are its own suggestions; only free-text questions need more.
      const asked = item.questions.filter(
        (question) => question.options.length === 0 && question.allowCustomAnswer !== false,
      );
      if (asked.length === 0) return { suggestions: [] };
      const settings = yield* settingsService.getSettings;
      const providers = yield* providerRegistry.getProviders;
      const modelSelection = resolveReplySuggestionModelSelection(settings, providers);
      const denied = [
        ...ALWAYS_DENIED_FALLBACK_MODELS,
        ...settings.usageLimitFallbackDeniedModels,
      ].map((entry) => entry.trim().toLowerCase());
      if (denied.includes(modelSelection.model.trim().toLowerCase())) {
        return yield* fail(
          `${modelSelection.model} is not used for suggestions. Pick a cheaper text generation model.`,
        );
      }
      // Providers run in a working directory; suggesting a reply must not read a checkout.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-needs-you-" });
      const generated = yield* textGeneration.generateReplySuggestions({
        cwd,
        prompt: replySuggestionPrompt(item.title, asked),
        modelSelection,
      });
      const result = {
        suggestions: cleanSuggestions(
          new Set(asked.map((question) => question.id)),
          generated.suggestions,
        ),
      };
      if (suggestions.size >= SUGGESTION_CACHE_LIMIT) suggestions.clear();
      suggestions.set(id, result);
      return result;
    },
    Effect.scoped,
    Effect.mapError((cause) =>
      cause instanceof NeedsYouError
        ? cause
        : fail(
            "detail" in cause && typeof cause.detail === "string"
              ? `No suggestions: ${cause.detail}`
              : "No suggestions could be made.",
          ),
    ),
  );

  const respond: NeedsYou["Service"]["respond"] = Effect.fn("NeedsYou.respond")(
    function* (input) {
      const here = yield* environment.getEnvironmentId;
      if (input.environmentId === here) {
        const shell = yield* threads.getThreadShell(input.threadId);
        if (shell === null || shell.deletedAt !== null) {
          return yield* fail("That thread was not found.");
        }
        yield* threads.dispatch({
          type: "runtime-request.respond",
          commandId: CommandId.make(`needs-you:${yield* random.uuidV4()}`),
          threadId: input.threadId,
          requestId: input.requestId,
          answers: input.answers,
        });
        return;
      }
      yield* peers
        .call({
          environmentId: input.environmentId as EnvironmentId,
          tool: "t3_pending_request",
          arguments: {
            action: "respond",
            threadId: input.threadId,
            requestId: input.requestId,
            answers: input.answers,
          },
          limits: PEER_LIMITS,
          success: Schema.Unknown,
        })
        .pipe(Effect.mapError((error) => fail(error.message)));
    },
    Effect.mapError((cause) =>
      cause instanceof NeedsYouError ? cause : fail("The answer could not be sent."),
    ),
  );

  return NeedsYou.of({ list, changes, hide, restore, suggest, respond });
});

export const layer = Layer.effect(NeedsYou, make);
