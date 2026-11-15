import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type Tot,
  TotError,
  type TotCreateInput,
  type TotWatch,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as GroupChatService from "../../../tots/GroupChatService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as TotHandlers from "./handlers.ts";
import { TotToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:tots");
const homeThread = ThreadId.make("tot:home:current");
const scopedThread = ThreadId.make("tot:yui:current");
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const scopedYui: Tot = {
  ...DEFAULT_HOME_TOT,
  id: "yui" as Tot["id"],
  name: "Yui",
  scope: { projects: [], groups: ["Cardinal"] },
  threadId: scopedThread,
  modelSelection: model,
};

const asTot = (input: TotCreateInput): Tot => ({
  ...DEFAULT_HOME_TOT,
  id: input.name.toLowerCase() as Tot["id"],
  name: input.name,
  scope: input.scope,
  projectId: ProjectId.make("project:new"),
  threadId: ThreadId.make(`tot:${input.name.toLowerCase()}:new`),
});

const harness = (callerThread: ThreadId) => {
  const watches: Array<TotWatch> = [];
  const created: Array<TotCreateInput> = [];
  const removed: Array<string> = [];
  const home: Tot = { ...DEFAULT_HOME_TOT, threadId: homeThread, modelSelection: model };
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "thread:tots",
      thread: {
        threadId: callerThread,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(GroupChatService.GroupChatService)({}),
    Layer.mock(TotService.TotService)({
      list: Effect.sync(() => [home, scopedYui, ...created.map(asTot)]),
      totForThread: (threadId) =>
        Effect.succeed(
          threadId === homeThread
            ? Option.some(home)
            : threadId === scopedThread
              ? Option.some(scopedYui)
              : Option.none(),
        ),
      create: (input) =>
        created.some((tot) => tot.name === input.name) || input.name === "Yui"
          ? Effect.fail(new TotError({ message: "A Tot named like this already exists." }))
          : Effect.sync(() => {
              created.push(input);
              return asTot(input);
            }),
      enable: (id) => Effect.succeed({ threadId: ThreadId.make(`tot:${id}:new`) }),
      remove: (id) => Effect.sync(() => void removed.push(id)),
      addWatch: (_id, watch) => Effect.sync(() => void watches.push(watch)),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedSome({ workspaceRoot: "/t3/tots/bob" } as never),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(liveThreadShell(threadId, { activeRunId: RunId.make("run") })),
    }),
    NodeCrypto.layer,
  );
  const call = (
    name: "t3_tot_list" | "t3_tot_watch" | "t3_tot_create",
    params: Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      const toolkit = yield* TotToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(TotHandlers.layer).pipe(Layer.provide(dependencies)),
        ),
      );
      const result = yield* toolkit
        .handle(name, params as never)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      return result.at(-1)?.result;
    });
  return { watches, created, removed, call };
};

it.effect("lists the Tots with a link to each one's thread", () =>
  Effect.gen(function* () {
    const { call } = harness(ThreadId.make("thread:any"));
    const listed = yield* call("t3_tot_list", {});
    expect(listed).toMatchObject({
      tots: [{ id: "home", name: "Home", enabled: true, threadId: homeThread }, { id: "yui" }],
    });
    expect(JSON.stringify(listed)).toContain("t3-thread://");
  }),
);

it.effect("a Tot asks to watch a thread here", () =>
  Effect.gen(function* () {
    const { call, watches } = harness(homeThread);
    yield* call("t3_tot_watch", { action: "watch", threadId: "thread:other" });
    expect(watches).toEqual([{ environmentId, threadId: "thread:other", reason: "requested" }]);
  }),
);

it.effect("only a Tot can watch threads", () =>
  Effect.gen(function* () {
    const { call, watches } = harness(ThreadId.make("thread:ordinary"));
    const result = yield* call("t3_tot_watch", { action: "watch", threadId: "thread:other" });
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(watches).toHaveLength(0);
  }),
);

const bob = { name: "Bob", scope: "all", instructions: "A designer." };

it.effect("Home creates a Tot that is turned on, with its folder and link", () =>
  Effect.gen(function* () {
    const { call, created } = harness(homeThread);
    const result = yield* call("t3_tot_create", bob);
    expect(result).toMatchObject({ id: "bob", scope: "all", folder: "/t3/tots/bob" });
    expect(JSON.stringify(result)).toContain("t3-thread://");
    expect(created).toMatchObject([
      { name: "Bob", instructions: "A designer.", modelSelection: model },
    ]);
  }),
);

it.effect("a Tot with a narrower scope cannot create Tots, even a scoped one", () =>
  Effect.gen(function* () {
    const { call, created } = harness(scopedThread);
    const result = yield* call("t3_tot_create", bob);
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(created).toHaveLength(0);
  }),
);

it.effect("only a Tot can create Tots", () =>
  Effect.gen(function* () {
    const { call, created } = harness(ThreadId.make("thread:ordinary"));
    const result = yield* call("t3_tot_create", bob);
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(created).toHaveLength(0);
  }),
);

it.effect("a name already taken is refused", () =>
  Effect.gen(function* () {
    const { call } = harness(homeThread);
    const result = yield* call("t3_tot_create", { ...bob, name: "Yui" });
    expect(result).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("already exists"),
    });
  }),
);
