import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type Tot,
  type TotId,
  TotError,
  type TotCreateInput,
  type TotTheme,
  type TotThemePatch,
  type TotWatch,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../../../scheduledTasks/ScheduledTaskService.ts";
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

/** A thread caller, or the user at a full-access client outside any thread. */
const harness = (callerThread: ThreadId | "person") => {
  const watches: Array<TotWatch> = [];
  const instructions = new Map<TotId, string>();
  const created: Array<TotCreateInput> = [];
  const removed: Array<string> = [];
  const themes = new Map<TotId, TotTheme>();
  const themePatches: Array<{ readonly id: TotId; readonly patch: TotThemePatch }> = [];
  const listeners: Array<
    Parameters<ScheduledTaskService.ScheduledTaskService["Service"]["upsert"]>[0]
  > = [];
  const home: Tot = { ...DEFAULT_HOME_TOT, threadId: homeThread, modelSelection: model };
  const stored = (tot: Tot): Tot => {
    const theme = themes.get(tot.id);
    const text = instructions.get(tot.id);
    const withText = text === undefined ? tot : { ...tot, instructions: text };
    return theme === undefined ? withText : { ...withText, theme };
  };
  const saveTheme = (id: TotId, patch: TotThemePatch): Tot => {
    themePatches.push({ id, patch });
    const current = [home, scopedYui].find((tot) => tot.id === id)!;
    const previous = stored(current).theme;
    const css = patch.css === undefined ? previous?.css : (patch.css ?? "");
    const effect = patch.effect === undefined ? previous?.effect : (patch.effect ?? "");
    const theme = {
      ...(css === undefined || css === "" ? {} : { css }),
      ...(effect === undefined || effect === "" ? {} : { effect }),
    };
    if (Object.keys(theme).length === 0) themes.delete(id);
    else themes.set(id, theme);
    return stored(current);
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "thread:tots",
      thread:
        callerThread === "person"
          ? undefined
          : {
              threadId: callerThread,
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
      client:
        callerThread === "person"
          ? { sessionId: "session", label: "Claude Code", access: "full-access" as const }
          : undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(GroupChatService.GroupChatService)({}),
    Layer.mock(TotService.TotService)({
      list: Effect.sync(() => [home, scopedYui, ...created.map(asTot)].map(stored)),
      totForThread: (threadId) =>
        Effect.succeed(
          threadId === homeThread
            ? Option.some(stored(home))
            : threadId === scopedThread
              ? Option.some(stored(scopedYui))
              : Option.none(),
        ),
      setTheme: (id, patch) => Effect.sync(() => saveTheme(id, patch)),
      update: (input) =>
        Effect.sync(() => {
          if (input.instructions !== undefined) instructions.set(input.id, input.instructions);
          return stored([home, scopedYui].find((tot) => tot.id === input.id)!);
        }),
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
    Layer.mock(ScheduledTaskService.ScheduledTaskService)({
      upsert: (input) =>
        Effect.sync(() => {
          listeners.push(input);
          return {
            task: {
              id: "scheduled-task:listener",
              title: input.title,
              prompt: input.prompt,
              enabled: true,
              schedule: input.schedule,
              projectId: input.projectId,
              threadId: input.threadId ?? null,
              threadMode: "continue",
              workspaceStrategy: input.workspaceStrategy,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              createdBy: "agent",
              creationSource: "mcp",
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z",
              nextRunAt: null,
              lastRunAt: null,
              lastRunStatus: "never",
              lastRunError: null,
              runCount: 0,
              webhook: {
                path: `/api/hooks/${input.id ?? "scheduled-task:listener"}/token`,
                url: `https://relay.example.com/v1/hooks/0123456789abcdef/${input.id ?? "scheduled-task:listener"}/token`,
                hasSecret: false,
              },
            },
          } as never;
        }),
    }),
    NodeCrypto.layer,
  );
  const call = (
    name:
      | "t3_tot_list"
      | "t3_tot_watch"
      | "t3_tot_create"
      | "t3_tot_webhook_listener"
      | "t3_tot_theme_set"
      | "t3_tot_theme_read"
      | "t3_tot_instructions",
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
  return { watches, created, removed, listeners, themePatches, instructions, call };
};

it.effect("lists the Tots with a link to each one's thread", () =>
  Effect.gen(function* () {
    const { call } = harness(ThreadId.make("thread:any"));
    const listed = yield* call("t3_tot_list", {});
    expect(listed).toMatchObject({
      tots: [
        {
          id: "home",
          name: "Home",
          enabled: true,
          threadId: homeThread,
          avatar: { color: "#0A7EA4" },
        },
        { id: "yui", avatar: { color: "#0A7EA4" } },
      ],
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

it.effect("a Tot creates a notify listener in its own thread and gets the URL", () =>
  Effect.gen(function* () {
    const { call, listeners } = harness(homeThread);
    const result = yield* call("t3_tot_webhook_listener", {
      name: "front-door-motion",
      cooldownSeconds: 30,
      filters: [{ path: "body.state", op: "equals", value: "on" }],
    });
    expect(result).toMatchObject({
      name: "front-door-motion",
      mode: "notify",
      webhookUrl: expect.stringContaining("https://relay.example.com/v1/hooks/"),
      link: expect.stringContaining("t3-thread://"),
    });
    expect(listeners).toMatchObject([
      {
        title: "front-door-motion",
        threadId: homeThread,
        projectId: "project:mcp-test",
        threadMode: "continue",
        createdByTotId: "home",
        workspaceStrategy: { type: "root" },
        schedule: {
          type: "webhook",
          filters: [{ path: "body.state", op: "equals", value: "on" }],
          listener: { mode: "notify", cooldownSeconds: 30 },
        },
      },
    ]);
  }),
);

it.effect("a wake listener frames the payload for the Tot", () =>
  Effect.gen(function* () {
    const { call, listeners } = harness(homeThread);
    yield* call("t3_tot_webhook_listener", { name: "doorbell", mode: "wake" });
    expect(listeners[0]?.prompt).toContain("untrusted data");
    expect(listeners[0]?.prompt).toContain("{{request}}");
    expect(listeners[0]?.schedule).toMatchObject({ listener: { mode: "wake" } });
  }),
);

it.effect("only a Tot whose scope is all can listen for another Tot", () =>
  Effect.gen(function* () {
    const { call, listeners } = harness(scopedThread);
    const result = yield* call("t3_tot_webhook_listener", { name: "doorbell", tot: "home" });
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(listeners).toHaveLength(0);
  }),
);

it.effect("only a Tot can create a listener", () =>
  Effect.gen(function* () {
    const { call, listeners } = harness(ThreadId.make("thread:ordinary"));
    const result = yield* call("t3_tot_webhook_listener", { name: "doorbell" });
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(listeners).toHaveLength(0);
  }),
);

it.effect("a Tot sets its own theme, and clearing one field keeps the other", () => {
  const { call, themePatches } = harness(homeThread);
  const css = ":root { color: red; }";
  return Effect.gen(function* () {
    const set = yield* call("t3_tot_theme_set", { css, effect: "sparkles" });
    expect(set).toMatchObject({ totId: "home", cssLength: css.length, effectLength: 8 });
    // The opaque effect text is never echoed back.
    expect(JSON.stringify(set)).not.toContain("sparkles");

    const read = yield* call("t3_tot_theme_read", {});
    expect(read).toMatchObject({ totId: "home", cssLength: css.length, effectLength: 8 });

    const cleared = yield* call("t3_tot_theme_set", { css: "" });
    expect(cleared).toMatchObject({ cssLength: 0, effectLength: 8 });
    expect(themePatches).toMatchObject([
      { id: "home", patch: { css, effect: "sparkles" } },
      { id: "home", patch: { css: "" } },
    ]);
  });
});

it.effect("a Tot whose scope is all still edits only its own theme", () => {
  const { call, themePatches } = harness(homeThread);
  return Effect.gen(function* () {
    const result = yield* call("t3_tot_theme_set", { effect: "glow" });
    expect(result).toMatchObject({ totId: "home" });
    expect(themePatches.map((entry) => entry.id)).toEqual(["home"]);
  });
});

it.effect("refuses a theme over the cap or one that loads remote files", () => {
  const { call, themePatches } = harness(homeThread);
  return Effect.gen(function* () {
    const tooLong = yield* call("t3_tot_theme_set", { css: "a".repeat(20_001) });
    expect(tooLong).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("20000"),
    });
    const remote = yield* call("t3_tot_theme_set", {
      css: "@import url(https://example.com/a.css);",
    });
    expect(remote).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("cannot load files"),
    });
    expect(themePatches).toHaveLength(0);
  });
});

it.effect("only a Tot can read or set a theme", () => {
  const { call, themePatches } = harness(ThreadId.make("thread:ordinary"));
  return Effect.gen(function* () {
    expect(yield* call("t3_tot_theme_set", { effect: "glow" })).toMatchObject({
      code: "capability_denied",
    });
    expect(yield* call("t3_tot_theme_read", {})).toMatchObject({ code: "capability_denied" });
    expect(themePatches).toHaveLength(0);
  });
});

it.effect("a Tot reads and replaces its own instructions, but not another's", () => {
  const { call, instructions } = harness(scopedThread);
  return Effect.gen(function* () {
    expect(yield* call("t3_tot_instructions", {})).toMatchObject({
      totId: "yui",
      instructions: "",
      updated: false,
    });
    expect(yield* call("t3_tot_instructions", { instructions: "Be brief." })).toMatchObject({
      totId: "yui",
      instructions: "Be brief.",
      updated: true,
    });
    expect(yield* call("t3_tot_instructions", { tot: "home", instructions: "x" })).toMatchObject({
      code: "capability_denied",
    });
    expect(yield* call("t3_tot_instructions", { tot: "home" })).toMatchObject({
      code: "capability_denied",
    });
    expect([...instructions]).toEqual([["yui", "Be brief."]]);
  });
});

it.effect("Home and the user can change any Tot's instructions; other agents cannot", () =>
  Effect.gen(function* () {
    const home = harness(homeThread);
    expect(
      yield* home.call("t3_tot_instructions", { tot: "yui", instructions: "From Home." }),
    ).toMatchObject({ totId: "yui", updated: true });
    const person = harness("person");
    expect(
      yield* person.call("t3_tot_instructions", { tot: "yui", instructions: "From the user." }),
    ).toMatchObject({ totId: "yui", instructions: "From the user." });
    expect(yield* person.call("t3_tot_instructions", {})).toMatchObject({
      code: "invalid_request",
    });
    const agent = harness(ThreadId.make("thread:ordinary"));
    expect(
      yield* agent.call("t3_tot_instructions", { tot: "yui", instructions: "Hijack." }),
    ).toMatchObject({ code: "capability_denied" });
    expect(agent.instructions.size).toBe(0);
  }),
);

it.effect("refuses instructions over the cap", () => {
  const { call, instructions } = harness(scopedThread);
  return Effect.gen(function* () {
    // The schema refuses it before the handler runs.
    const refused = yield* call("t3_tot_instructions", { instructions: "a".repeat(20_001) });
    expect(refused).toMatchObject({ reason: { _tag: "ToolParameterValidationError" } });
    expect(instructions.size).toBe(0);
  });
});
