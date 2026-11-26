import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  type NeedsYouInbox,
  type NeedsYouItem,
  OrchestratorMcpFailure,
  ProjectId,
  RuntimeRequestId,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
  TotId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

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
import * as ExternalCompanions from "../companions/ExternalCompanions.ts";
import * as NeedsYou from "./NeedsYou.ts";
import { runItem } from "./needsYouItems.ts";

const here = EnvironmentId.make("env-asuna");
const box = EnvironmentId.make("env-box");
const project = ProjectId.make("project:app");
const utc = (iso: string) => DateTime.makeUnsafe(iso);

const shell = (fields: Record<string, unknown>) =>
  ({
    projectId: project,
    title: "Thread",
    status: "idle",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "root" },
    archivedAt: null,
    deletedAt: null,
    pendingRuntimeRequest: null,
    latestRunId: null,
    latestRunCompletedAt: null,
    lastVisitedAt: null,
    lastError: null,
    ...fields,
  }) as never;

const questionThread = ThreadId.make("tot:yui:1");
const approvalThread = ThreadId.make("thread:deploy");
const question = {
  id: "q1",
  header: "Branch",
  question: "Which branch should I release from?",
  options: [],
};
const shells = [
  shell({
    id: questionThread,
    title: "Yui",
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("req-q"),
      kind: "user_input",
      createdAt: utc("2026-11-25T10:00:00Z"),
    },
  }),
  shell({
    id: approvalThread,
    title: "Deploy",
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("req-a"),
      kind: "command",
      createdAt: utc("2026-11-25T09:00:00Z"),
    },
  }),
  shell({
    id: ThreadId.make("thread:broken"),
    title: "Broken",
    status: "failed",
    latestRunId: "run-1",
    latestRunCompletedAt: utc("2026-11-25T08:00:00Z"),
    lastVisitedAt: utc("2026-11-25T07:00:00Z"),
    lastError: "provider exited",
  }),
];
const records: Record<string, unknown> = {
  [questionThread]: {
    runtimeRequests: [
      {
        id: "req-q",
        kind: "user_input",
        status: "pending",
        createdAt: utc("2026-11-25T10:00:00Z"),
      },
    ],
    turnItems: [{ type: "user_input_request", requestId: "req-q", questions: [question] }],
  },
  [approvalThread]: {
    runtimeRequests: [
      { id: "req-a", kind: "command", status: "pending", createdAt: utc("2026-11-25T09:00:00Z") },
    ],
    turnItems: [{ type: "approval_request", requestId: "req-a", prompt: "pnpm deploy" }],
  },
};
const failedTask = {
  id: ScheduledTaskId.make("task:nightly"),
  title: "Nightly",
  threadId: null,
  lastRunAt: "2026-11-25T06:00:00.000Z",
  lastRunStatus: "failed",
  lastRunError: "usage_limit",
  createdByTotId: TotId.make("yui"),
} as unknown as ScheduledTask;

const boxItem: NeedsYouItem = {
  key: "request:thread:box:req-b",
  kind: "question",
  threadId: ThreadId.make("thread:box"),
  title: "Box work",
  summary: "Ship it?",
  at: "2026-11-25T11:00:00.000Z",
  totId: null,
  requestId: RuntimeRequestId.make("req-b"),
  questions: [{ ...question, id: "qb", question: "Ship it?" }],
};

interface Harness {
  readonly dispatched: Array<unknown>;
  readonly peerCalls: Array<{ environmentId: string; tool: string; arguments: unknown }>;
  readonly prompts: Array<string>;
}

const companionItem: NeedsYouItem = {
  key: "companion:demo:n-1",
  kind: "companion",
  threadId: null,
  title: "Demo Companion",
  summary: "Deploy now?",
  at: "2026-11-25T08:00:00.000Z",
  totId: null,
  companion: {
    companionId: "demo",
    name: "Demo Companion",
    needsYouId: "n-1",
    channel: "main",
    kind: "approval",
    options: [],
  },
};

const run = <A, E>(
  body: (service: NeedsYou.NeedsYou["Service"], harness: Harness) => Effect.Effect<A, E>,
  options: {
    readonly peerDown?: boolean;
    readonly model?: string;
    readonly companions?: ReadonlyArray<NeedsYouItem>;
  } = {},
) =>
  Effect.gen(function* () {
    const harness: Harness = { dispatched: [], peerCalls: [], prompts: [] };
    const settings = yield* Effect.provide(
      Effect.flatMap(ServerSettings.ServerSettingsService, (service) => service.getSettings),
      ServerSettings.layerTest(),
    );
    const layer = NeedsYou.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-needs-you-test-" }),
          ServerSettings.layerTest(
            options.model === undefined
              ? {}
              : {
                  textGenerationModelSelection: {
                    ...settings.textGenerationModelSelection,
                    model: options.model,
                  },
                },
          ),
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(here),
            getDescriptor: Effect.succeed({ environmentId: here, label: "Asuna" } as never),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getShellSnapshot: () => Effect.succeed({ threads: shells } as never),
            getProjectThreadRecords: (input) => Effect.succeed(records[input.threadId] as never),
            getThreadShell: (threadId) =>
              Effect.succeed(
                (shells as Array<{ id: string }>).find((s) => s.id === threadId) as never,
              ),
            dispatch: (command) =>
              Effect.sync(() => {
                harness.dispatched.push(command);
                return { sequence: 1 } as never;
              }),
            streamDomainEvents: Stream.never,
          }),
          Layer.mock(TotService.TotService)({
            list: Effect.succeed([{ id: TotId.make("yui"), name: "Yui" }] as never),
          }),
          Layer.mock(ScheduledTasks.ScheduledTaskService)({
            list: () => Effect.succeed({ tasks: [failedTask] }),
            subscribeList: () => Stream.never,
          }),
          Layer.mock(PeerLinks.PeerLinks)({
            enabled: Effect.succeed(true),
            names: Effect.succeed([{ environmentId: box, label: "Box" }]),
          }),
          Layer.mock(PeerMcpClient.PeerMcpClient)({
            call: (input) =>
              Effect.suspend(() => {
                harness.peerCalls.push({
                  environmentId: input.environmentId,
                  tool: input.tool,
                  arguments: input.arguments,
                });
                if (options.peerDown === true) {
                  return Effect.fail(
                    new OrchestratorMcpFailure({
                      code: "orchestration_error",
                      message: "Box did not answer.",
                    }),
                  );
                }
                const inbox: NeedsYouInbox = {
                  environments: [
                    {
                      environmentId: box,
                      label: "box itself",
                      local: true,
                      error: null,
                      tots: [],
                      items: [boxItem],
                    },
                  ],
                };
                return Effect.succeed((input.tool === "t3_needs_you" ? inbox : {}) as never);
              }),
          }),
          Layer.mock(TextGeneration.TextGeneration)({
            generateReplySuggestions: (input) =>
              Effect.sync(() => {
                harness.prompts.push(input.prompt);
                return {
                  suggestions: [
                    { questionId: "q1", answers: ["main", " main ", "release/1.4", "", "x", "y"] },
                    { questionId: "not-asked", answers: ["nope"] },
                  ],
                };
              }),
          }),
          Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
          options.companions === undefined
            ? Layer.empty
            : Layer.mock(ExternalCompanions.ExternalCompanions)({
                needsYouItems: Effect.succeed(options.companions),
                needsYouChanges: Stream.empty,
              }),
          Layer.succeed(SecureRandom.SecureRandom, {
            uuidV4: () => Effect.succeed("00000000-0000-4000-8000-000000000000"),
          } as never),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      return yield* body(yield* NeedsYou.NeedsYou, harness);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const keys = (inbox: NeedsYouInbox, environmentId: string) =>
  inbox.environments
    .find((entry) => entry.environmentId === environmentId)
    ?.items.map((item) => item.key) ?? [];

describe("NeedsYou", () => {
  it.effect(
    "lists questions, approvals, unseen failures and scheduled failures with linked ones",
    () =>
      run((service, harness) =>
        Effect.gen(function* () {
          const inbox = yield* service.list({});
          const local = inbox.environments[0]!;
          assert.equal(local.label, "Asuna");
          assert.isTrue(local.local);
          assert.deepEqual(
            local.items.map((item) => [item.kind, item.totId, item.summary]),
            [
              ["question", "yui", "Which branch should I release from?"],
              ["approval", null, "command: pnpm deploy"],
              ["failed_run", null, "Failed: provider exited"],
              ["scheduled_failure", "yui", "Scheduled run failed: usage_limit"],
            ],
          );
          assert.deepEqual(local.tots, [{ id: TotId.make("yui"), name: "Yui" }]);
          const linked = inbox.environments[1]!;
          assert.equal(linked.label, "Box");
          assert.isFalse(linked.local);
          assert.deepEqual(linked.items, [boxItem]);
          // The peer is asked for its own items only, so links never loop.
          assert.deepEqual(harness.peerCalls, [
            { environmentId: box, tool: "t3_needs_you", arguments: { linked: false } },
          ]);
        }),
      ),
  );

  it.effect("lists what companions wait on as their own source, next to the threads", () =>
    run(
      (service) =>
        Effect.gen(function* () {
          const inbox = yield* service.list({ linked: false });
          const companion = inbox.environments[0]!.items.find((item) => item.kind === "companion");
          assert.deepEqual(companion, companionItem);
          assert.lengthOf(inbox.environments[0]!.items, 5);
        }),
      { companions: [companionItem] },
    ),
  );

  it.effect("shows a linked environment that did not answer with its error, keeping the rest", () =>
    run(
      (service) =>
        Effect.gen(function* () {
          const inbox = yield* service.list({});
          assert.lengthOf(inbox.environments[0]!.items, 4);
          assert.deepEqual(inbox.environments[1], {
            environmentId: box,
            label: "Box",
            local: false,
            error: "Box did not answer.",
            tots: [],
            items: [],
          });
        }),
      { peerDown: true },
    ),
  );

  it.effect("dismisses, snoozes and restores items, here and in a linked environment", () =>
    run((service) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-11-25T12:00:00.000Z"));
        const approvalKey = `request:${approvalThread}:req-a`;
        yield* service.hide({ environmentId: here, key: approvalKey, until: null });
        yield* service.hide({
          environmentId: box,
          key: boxItem.key,
          until: "2999-01-01T00:00:00.000Z",
        });
        // A snooze that has already ended shows the item again.
        yield* service.hide({
          environmentId: here,
          key: "scheduled:task:nightly:2026-11-25T06:00:00.000Z",
          until: "2000-01-01T00:00:00.000Z",
        });
        const visible = yield* service.list({});
        assert.notInclude(keys(visible, here), approvalKey);
        assert.include(keys(visible, here), "scheduled:task:nightly:2026-11-25T06:00:00.000Z");
        assert.deepEqual(keys(visible, box), []);

        const all = yield* service.list({ includeHidden: true });
        const hidden = all.environments.flatMap((entry) =>
          entry.items.filter((item) => item.hiddenUntil !== undefined).map((item) => item.key),
        );
        assert.deepEqual(hidden, [approvalKey, boxItem.key]);

        yield* service.restore({ environmentId: here, key: approvalKey });
        yield* service.restore({ environmentId: box, key: boxItem.key });
        const restored = yield* service.list({});
        assert.include(keys(restored, here), approvalKey);
        assert.deepEqual(keys(restored, box), [boxItem.key]);
      }),
    ),
  );

  it.live("emits the inbox when something is hidden", () =>
    run((service) =>
      Effect.gen(function* () {
        const approvalKey = `request:${approvalThread}:req-a`;
        const seen = yield* service.changes({ linked: false }).pipe(
          Stream.take(2),
          Stream.tap((inbox) =>
            keys(inbox, here)?.includes(approvalKey) === true
              ? service.hide({ environmentId: here, key: approvalKey, until: null })
              : Effect.void,
          ),
          Stream.runCollect,
        );
        assert.include(keys(seen[0]!, here), approvalKey);
        assert.notInclude(keys(seen[1]!, here), approvalKey);
      }),
    ),
  );

  it.effect("suggests up to three distinct replies to free-text questions and caches them", () =>
    run((service, harness) =>
      Effect.gen(function* () {
        yield* service.list({});
        const ref = { environmentId: here, key: `request:${questionThread}:req-q` };
        const first = yield* service.suggest(ref);
        assert.deepEqual(first, {
          suggestions: [{ questionId: "q1", answers: ["main", "release/1.4", "x"] }],
        });
        assert.deepEqual(yield* service.suggest(ref), first);
        assert.lengthOf(harness.prompts, 1);
        assert.include(harness.prompts[0], "Which branch should I release from?");
      }),
    ),
  );

  it.effect("suggests for a linked environment's question from its listed text", () =>
    run((service, harness) =>
      Effect.gen(function* () {
        yield* service.suggest({ environmentId: box, key: boxItem.key });
        assert.include(harness.prompts[0], "Ship it?");
      }),
    ),
  );

  it.effect("never uses the full GLM 5.3 model for suggestions", () =>
    run(
      (service, harness) =>
        Effect.gen(function* () {
          yield* service.list({});
          const error = yield* service
            .suggest({ environmentId: here, key: `request:${questionThread}:req-q` })
            .pipe(Effect.flip);
          assert.include(error.message, "opencode-go/glm-5.3");
          assert.lengthOf(harness.prompts, 0);
        }),
      { model: "opencode-go/glm-5.3" },
    ),
  );

  it.effect("answers here through the thread's respond command, and over the link elsewhere", () =>
    run((service, harness) =>
      Effect.gen(function* () {
        yield* service.respond({
          environmentId: here,
          threadId: questionThread,
          requestId: RuntimeRequestId.make("req-q"),
          answers: { q1: "main" },
        });
        assert.deepEqual(harness.dispatched, [
          {
            type: "runtime-request.respond",
            commandId: "needs-you:00000000-0000-4000-8000-000000000000",
            threadId: questionThread,
            requestId: "req-q",
            answers: { q1: "main" },
          },
        ]);
        yield* service.respond({
          environmentId: box,
          threadId: boxItem.threadId!,
          requestId: boxItem.requestId!,
          answers: { qb: "yes" },
        });
        assert.deepEqual(harness.peerCalls.at(-1), {
          environmentId: box,
          tool: "t3_pending_request",
          arguments: {
            action: "respond",
            threadId: "thread:box",
            requestId: "req-b",
            answers: { qb: "yes" },
          },
        });
      }),
    ),
  );
});

describe("runItem", () => {
  const failed = {
    id: ThreadId.make("thread:x"),
    status: "failed",
    latestRunId: "run-1",
    latestRunCompletedAt: utc("2026-11-25T08:00:00Z"),
  };
  it("skips a run the user opened after it ended, and subagent runs", () => {
    assert.isNull(runItem(shell({ ...failed, lastVisitedAt: utc("2026-11-25T09:00:00Z") })));
    assert.isNull(
      runItem(
        shell({
          ...failed,
          lineage: { parentThreadId: "p", relationshipToParent: "subagent", rootThreadId: "p" },
        }),
      ),
    );
    assert.equal(runItem(shell({ ...failed, status: "interrupted" }))?.kind, "stopped_run");
    assert.isNull(runItem(shell({ ...failed, status: "completed" })));
  });
});
