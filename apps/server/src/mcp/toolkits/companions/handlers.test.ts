import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId, type RuntimeMode } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as CompanionThemeHandlers from "./handlers.ts";
import { CompanionThemeToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:companion-theme");
const threadId = ThreadId.make("thread:companion-theme");

const callers = Effect.gen(function* () {
  const toolkit = yield* CompanionThemeToolkit;
  const set = (params: Parameters<typeof toolkit.handle<"t3_companion_theme_set">>[1]) =>
    toolkit.handle("t3_companion_theme_set", params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((parts) => parts.at(-1)?.result),
    );
  const read = (params: Parameters<typeof toolkit.handle<"t3_companion_theme_read">>[1]) =>
    toolkit.handle("t3_companion_theme_read", params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((parts) => parts.at(-1)?.result),
    );
  return { set, read };
});
type Callers = Effect.Success<typeof callers>;

const run = <A, E, R>(
  body: (tools: Callers) => Effect.Effect<A, E, R>,
  runtimeMode: RuntimeMode = "full-access",
) => {
  const dependencies = Layer.mergeAll(
    Settings.ServerSettingsService.layerTest({
      externalCompanions: [
        { id: "yui", label: "Yui", baseUrl: "http://127.0.0.1:4790", token: "secret" },
        { id: "other", label: "Other", baseUrl: "http://127.0.0.1:4791", token: "" },
      ],
    }),
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "provider:companion-theme",
      thread: {
        threadId,
        providerSessionId: "provider:companion-theme",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed(liveThreadShell(threadId, { runtimeMode })),
    }),
  );
  return Effect.gen(function* () {
    const result = yield* body(yield* callers);
    const service = yield* Settings.ServerSettingsService;
    return { result, stored: (yield* service.getSettings).externalCompanions };
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(CompanionThemeHandlers.layer).pipe(
        Layer.provideMerge(dependencies),
      ),
    ),
  );
};

const YUI_CSS = '[data-tot-id="yui"] .chat-markdown { color: #eaf0fb; }';

it.effect("sets one companion's theme, merging fields, and reports sizes, not the text", () =>
  Effect.gen(function* () {
    const { result, stored } = yield* run((tools) =>
      Effect.gen(function* () {
        const set = yield* tools.set({ companionId: "yui", css: YUI_CSS });
        yield* tools.set({ companionId: "yui", effect: "fx.canvas" });
        const read = yield* tools.read({ companionId: "yui" });
        return { set, read };
      }),
    );
    expect(result.set).toEqual({
      companionId: "yui",
      selector: '[data-companion-id="yui"]',
      cssLength: YUI_CSS.length,
      effectLength: 0,
      summary: `${YUI_CSS.length} characters of CSS, no effect`,
    });
    expect(result.read).toMatchObject({ cssLength: YUI_CSS.length, effectLength: 9 });
    expect(JSON.stringify(result.read)).not.toContain("chat-markdown");
    expect(stored.find((entry) => entry.id === "yui")).toMatchObject({
      token: "secret",
      theme: { css: YUI_CSS, effect: "fx.canvas" },
    });
    expect(stored.find((entry) => entry.id === "other")?.theme).toBeUndefined();
  }),
);

it.effect("clears one field with null or empty, and drops the theme when nothing is left", () =>
  Effect.gen(function* () {
    const { stored } = yield* run((tools) =>
      Effect.gen(function* () {
        yield* tools.set({ companionId: "yui", css: YUI_CSS, effect: "fx" });
        yield* tools.set({ companionId: "yui", css: null });
        yield* tools.set({ companionId: "yui", effect: "" });
      }),
    );
    expect(stored.find((entry) => entry.id === "yui")).not.toHaveProperty("theme");
  }),
);

it.effect("refuses CSS that loads files, an oversized field, and an unknown companion", () =>
  Effect.gen(function* () {
    const { result, stored } = yield* run((tools) =>
      Effect.all({
        remote: tools.set({ companionId: "yui", css: '@import url("https://example.com/x.css");' }),
        image: tools.set({
          companionId: "yui",
          css: ".x { background: url(https://example.com/a.png); }",
        }),
        long: tools.set({ companionId: "yui", effect: "x".repeat(20_001) }),
        missing: tools.set({ companionId: "nobody", css: ".x{}" }),
        missingRead: tools.read({ companionId: "nobody" }),
      }),
    );
    expect(result.remote).toMatchObject({ code: "invalid_request" });
    expect(result.image).toMatchObject({ code: "invalid_request" });
    expect(result.long).toMatchObject({
      code: "invalid_request",
      message: "theme.effect is 20001 characters; the limit is 20000.",
    });
    expect(result.missing).toMatchObject({ code: "invalid_request" });
    expect(result.missingRead).toMatchObject({ code: "invalid_request" });
    expect(stored.every((entry) => entry.theme === undefined)).toBe(true);
  }),
);

it.effect("refuses a set from a thread without full access", () =>
  Effect.gen(function* () {
    const { result, stored } = yield* run(
      (tools) => tools.set({ companionId: "yui", css: ".x{}" }),
      "approval-required",
    );
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(stored.every((entry) => entry.theme === undefined)).toBe(true);
  }),
);
