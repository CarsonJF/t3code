import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type TotWatch,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as TotHandlers from "./handlers.ts";
import { TotToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:tots");
const homeThread = ThreadId.make("tot:home:current");

const harness = (callerThread: ThreadId) => {
  const watches: Array<TotWatch> = [];
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
    Layer.mock(TotService.TotService)({
      list: Effect.succeed([{ ...DEFAULT_HOME_TOT, threadId: homeThread }]),
      totForThread: (threadId) =>
        Effect.succeed(
          threadId === homeThread
            ? Option.some({ ...DEFAULT_HOME_TOT, threadId: homeThread })
            : Option.none(),
        ),
      addWatch: (_id, watch) => Effect.sync(() => void watches.push(watch)),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(liveThreadShell(threadId, { activeRunId: RunId.make("run") })),
    }),
    NodeCrypto.layer,
  );
  const call = (name: "t3_tot_list" | "t3_tot_watch", params: Record<string, unknown>) =>
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
  return { watches, call };
};

it.effect("lists the Tots with a link to each one's thread", () =>
  Effect.gen(function* () {
    const { call } = harness(ThreadId.make("thread:any"));
    const listed = yield* call("t3_tot_list", {});
    expect(listed).toMatchObject({
      tots: [{ id: "home", name: "Home", enabled: true, threadId: homeThread }],
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
