import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type AuthMcpClientAccess,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "../tots/TotService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";
import { readTotCaller, refuseTots, requireTotChange, senderForForwarding } from "./totCaller.ts";

const environmentId = EnvironmentId.make("environment:tot-caller");
const homeThread = ThreadId.make("tot:home:current");

const threadScope = (threadId: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  requestNamespace: "thread:tot-caller",
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
});

const linkedScope = (
  access: AuthMcpClientAccess,
  senderThreadId: string,
): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  requestNamespace: "client:tot-caller",
  thread: undefined,
  client: {
    sessionId: "peer",
    label: "Asuna",
    access,
    linked: true,
    senderThread: {
      environmentId: EnvironmentId.make("asuna"),
      threadId: ThreadId.make(senderThreadId),
      title: "Yui",
    },
  },
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
});

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | McpInvocationContext.McpInvocationContext
    | TotService.TotService
    | ThreadManagement.ThreadManagementService
  >,
  scope: McpInvocationContext.McpInvocationScope,
  shell = liveThreadShell(homeThread, { activeRunId: RunId.make("run") }),
) =>
  effect.pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(TotService.TotService)({
          totForThread: (threadId) =>
            Effect.succeed(
              threadId === homeThread
                ? Option.some({ ...DEFAULT_HOME_TOT, threadId: homeThread })
                : Option.none(),
            ),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
        }),
      ),
    ),
  );

it.effect("recognises the current Tot thread here", () =>
  Effect.gen(function* () {
    const caller = yield* run(readTotCaller(), threadScope(homeThread));
    expect(caller).toEqual(Option.some({ totId: "home", name: "Home", via: "local" }));
  }),
);

it.effect("gives a former or ordinary thread no Tot grant", () =>
  Effect.gen(function* () {
    const caller = yield* run(readTotCaller(), threadScope(ThreadId.make("tot:home:former")));
    expect(Option.isNone(caller)).toBe(true);
  }),
);

it.effect("recognises a Tot calling through a full-access link", () =>
  Effect.gen(function* () {
    const caller = yield* run(readTotCaller(), linkedScope("full-access", "tot:yui:n1"));
    expect(caller).toEqual(Option.some({ totId: "yui", name: "Yui", via: "linked" }));
  }),
);

it.effect("does not trust a Tot sender over a link paired below full access", () =>
  Effect.gen(function* () {
    const caller = yield* run(readTotCaller(), linkedScope("auto", "tot:yui:n1"));
    expect(Option.isNone(caller)).toBe(true);
  }),
);

it.effect("does not treat an ordinary linked sender as a Tot", () =>
  Effect.gen(function* () {
    const caller = yield* run(readTotCaller(), linkedScope("full-access", "thread:x"));
    expect(Option.isNone(caller)).toBe(true);
  }),
);

it.effect("a Tot in plan mode cannot make changes", () =>
  Effect.gen(function* () {
    const failure = yield* run(
      Effect.flip(requireTotChange()),
      threadScope(homeThread),
      liveThreadShell(homeThread, { interactionMode: "plan", activeRunId: RunId.make("run") }),
    );
    expect(failure.code).toBe("capability_denied");
  }),
);

it.effect("a live full-access Tot can make changes", () =>
  Effect.gen(function* () {
    const caller = yield* run(requireTotChange(), threadScope(homeThread));
    expect(caller.totId).toBe("home");
  }),
);

it.effect("refuses a Tot what Tots may never do, and lets anyone else through", () =>
  Effect.gen(function* () {
    const refused = yield* run(
      Effect.flip(refuseTots("A Tot cannot delete projects.")),
      threadScope(homeThread),
    );
    expect(refused).toMatchObject({
      code: "capability_denied",
      message: "A Tot cannot delete projects.",
    });
    const linked = yield* run(
      Effect.flip(refuseTots("A Tot cannot delete projects.")),
      linkedScope("full-access", "tot:yui:n1"),
    );
    expect(linked.code).toBe("capability_denied");
    yield* run(refuseTots("A Tot cannot delete projects."), threadScope(ThreadId.make("thread:x")));
  }),
);

it.effect("forwards a Tot's identity only from its current thread", () =>
  Effect.gen(function* () {
    const sender = (threadId: string) =>
      run(
        senderForForwarding(environmentId, { id: ThreadId.make(threadId), title: "Home" }),
        threadScope(homeThread),
      );
    expect(yield* sender("tot:home:current")).toEqual({
      environmentId,
      threadId: "tot:home:current",
      title: "Home",
    });
    expect(yield* sender("tot:home:former")).toBeUndefined();
    expect(yield* sender("thread:ordinary")).toMatchObject({ threadId: "thread:ordinary" });
  }),
);
