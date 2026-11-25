import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TotError,
  type AvatarFigure,
  type AvatarTheme,
  type RuntimeMode,
  type Tot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as AvatarLibraryHandlers from "./handlers.ts";
import { AvatarLibraryToolkit } from "./tools.ts";

const lighthouse: AvatarFigure = {
  version: 1,
  id: "lighthouse",
  name: "Lighthouse",
  body: { path: "M38 30 L62 30 L68 88 L32 88 Z M42 14 L58 14 L60 30 L40 30 Z" },
  eyes: { x: 50, y: 56, spacing: 14, scale: 1 },
};
const beacon: AvatarTheme = {
  id: "beacon",
  name: "Beacon",
  avatar: { color: "#EA580C", style: "open-bot", openBot: { figure: "lighthouse" } },
};

const harness = (options: { readonly runtimeMode?: RuntimeMode } = {}) => {
  const figures: Array<AvatarFigure> = [];
  const themes: Array<AvatarTheme> = [];
  const rendered: Array<string> = [];
  const applied: Array<{ readonly id: string; readonly theme: string }> = [];
  const threadId = ThreadId.make("thread:designer");
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment:avatars"),
      requestNamespace: "thread:avatars",
      thread: {
        threadId,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.succeed(
          liveThreadShell(id, {
            activeRunId: RunId.make("run"),
            ...(options.runtimeMode === undefined ? {} : { runtimeMode: options.runtimeMode }),
          }),
        ),
    }),
    Layer.mock(TotService.TotService)({
      avatarLibrary: Effect.sync(() => ({ figures: [...figures], themes: [...themes] })),
      saveFigure: (figure) =>
        figure.id === "mug"
          ? Effect.fail(new TotError({ message: '"mug" is a built-in figure; pick another id.' }))
          : Effect.sync(() => {
              figures.push(figure);
              return figure;
            }),
      saveTheme: (theme) =>
        Effect.sync(() => {
          themes.push(theme);
          return theme;
        }),
      removeLibraryItem: (kind, id) =>
        Effect.sync(() => {
          const list = kind === "figure" ? figures : themes;
          list.splice(
            list.findIndex((entry) => entry.id === id),
            1,
          );
        }),
      applyTheme: (id, theme) =>
        Effect.sync((): Tot => {
          applied.push({ id, theme });
          return { ...DEFAULT_HOME_TOT, avatar: beacon.avatar };
        }),
    }),
    Layer.mock(HtmlRender.HtmlRender)({
      preview: (input) =>
        Effect.sync(() => {
          rendered.push("html" in input ? input.html : input.path);
          return {
            png: "cG5n",
            width: 480,
            contentHeight: 200,
            capturedHeight: 200,
            consoleMessages: [],
          };
        }),
    }),
  );
  const call = (params: Record<string, unknown>) =>
    Effect.gen(function* () {
      const toolkit = yield* AvatarLibraryToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(AvatarLibraryHandlers.layer).pipe(
            Layer.provide(dependencies),
          ),
        ),
      );
      const result = yield* toolkit
        .handle("t3_avatar_library", params as never)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      return result.at(-1)?.result;
    });
  return { figures, themes, rendered, applied, call };
};

it.effect("saves a figure and answers with a PNG of it", () =>
  Effect.gen(function* () {
    const { call, figures, rendered } = harness();
    const result = yield* call({ action: "save_figure", figure: lighthouse });
    expect(figures).toEqual([lighthouse]);
    expect(result).toMatchObject({ screenshot: { mimeType: "image/png", data: "cG5n" } });
    expect(rendered[0]).toContain("<svg");
  }),
);

it.effect("hands out the vendored design prompt", () =>
  Effect.gen(function* () {
    const { call } = harness();
    const result = yield* call({ action: "design_prompt" });
    expect(result).toMatchObject({ prompt: expect.stringContaining("# Avatar geometry designer") });
  }),
);

it.effect("passes the store's refusal back to the agent", () =>
  Effect.gen(function* () {
    const { call, figures } = harness();
    const result = yield* call({ action: "save_figure", figure: { ...lighthouse, id: "mug" } });
    expect(result).toMatchObject({ message: '"mug" is a built-in figure; pick another id.' });
    expect(figures).toEqual([]);
  }),
);

it.effect("lists library themes with the built-in looks, and deletes one", () =>
  Effect.gen(function* () {
    const { call } = harness();
    yield* call({ action: "save_theme", theme: beacon });
    expect(yield* call({ action: "list" })).toMatchObject({
      themes: expect.arrayContaining([
        { id: "beacon", name: "Beacon" },
        { id: "classic", name: "Classic" },
        { id: "chatterbox", name: "Chatterbox" },
      ]),
    });
    const after = yield* call({ action: "delete", kind: "theme", id: "beacon" });
    expect(after).toMatchObject({
      themes: expect.not.arrayContaining([{ id: "beacon", name: "Beacon" }]),
    });
  }),
);

it.effect("applies a theme to a Tot and previews the result", () =>
  Effect.gen(function* () {
    const { call, applied } = harness();
    const result = yield* call({ action: "apply", totId: "home", id: "beacon" });
    expect(applied).toEqual([{ id: "home", theme: "beacon" }]);
    expect(result).toMatchObject({ screenshot: { mimeType: "image/png" } });
  }),
);

it.effect("has no PNG for a BoopFace theme, and says why", () =>
  Effect.gen(function* () {
    const { call, rendered } = harness();
    const result = yield* call({ action: "preview", kind: "theme", id: "classic" });
    expect(result).toEqual({
      note: "BoopFace looks are drawn by the app; this theme has no PNG preview.",
    });
    expect(rendered).toEqual([]);
  }),
);

it.effect("lets only a full-access thread name a file to export or import", () =>
  Effect.gen(function* () {
    const { call } = harness({ runtimeMode: "approval-required" });
    const result = yield* call({ action: "import", path: "/tmp/anything.json" });
    expect(result).toMatchObject({ code: "capability_denied" });
  }),
);
