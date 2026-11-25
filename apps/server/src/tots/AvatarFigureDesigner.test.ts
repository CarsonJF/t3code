import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError, type ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as AvatarFigureDesigner from "./AvatarFigureDesigner.ts";

const fairy = {
  version: 1,
  id: "fairy",
  name: "Fairy",
  body: {
    path: "M50 24C62 24 70 33 70 46V70C70 80 62 86 50 86C38 86 30 80 30 70V46C30 33 38 24 50 24Z",
  },
  eyes: { x: 50, y: 50, spacing: 15, scale: 1 },
};
/** Eyes on the canvas edge: the renderer refuses it. */
const offCanvas = { ...fairy, eyes: { ...fairy.eyes, x: 2, y: 2 } };

const isTextGenerationError = Schema.is(TextGenerationError);

const cheap: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };

const harness = (
  replies: ReadonlyArray<unknown>,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) => {
  const prompts: string[] = [];
  const models: ModelSelection[] = [];
  const layer = AvatarFigureDesigner.layer.pipe(
    Layer.provide(
      Layer.succeed(TextGeneration.TextGeneration, {
        generateAvatarFigure: (input: { prompt: string; modelSelection: ModelSelection }) =>
          Effect.suspend(() => {
            prompts.push(input.prompt);
            models.push(input.modelSelection);
            const reply = replies[prompts.length - 1];
            return isTextGenerationError(reply) ? Effect.fail(reply) : Effect.succeed(reply);
          }),
      } as unknown as TextGeneration.TextGeneration["Service"]),
    ),
    Layer.provide(
      Layer.succeed(ProviderRegistry.ProviderRegistry, {
        getProviders: Effect.succeed([]),
      } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
    ),
    Layer.provide(ServerSettings.layerTest({ textGenerationModelSelection: cheap, ...settings })),
    Layer.provide(NodeServices.layer),
  );
  const describe = (description: string) =>
    Effect.gen(function* () {
      const designer = yield* AvatarFigureDesigner.AvatarFigureDesigner;
      return yield* designer.describe(description);
    }).pipe(Effect.provide(layer));
  return { prompts, models, describe };
};

it.effect("designs a figure with the vendored prompt and the description", () =>
  Effect.gen(function* () {
    const { describe, prompts, models } = harness([fairy]);
    const result = yield* describe("A pink fairy with butterfly wings");
    expect(result.figure).toEqual(fairy);
    expect(result.previewSvg).toContain("<svg");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/^# Avatar geometry designer/);
    expect(prompts[0]).toContain(
      "Create one avatar definition from this description: A pink fairy with butterfly wings",
    );
    expect(models).toMatchObject([cheap]);
  }),
);

it.effect("retries once with the engine's errors when the first figure is invalid", () =>
  Effect.gen(function* () {
    const { describe, prompts } = harness([offCanvas, fairy]);
    const result = yield* describe("A pink fairy");
    expect(result.figure).toEqual(fairy);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Your previous answer was rejected");
    expect(prompts[1]).toContain(JSON.stringify(offCanvas));
    expect(prompts[1]).toContain(AvatarFigureDesigner.figureErrors(offCanvas)[0]);
  }),
);

it.effect("fails after the retry when the figure is still invalid", () =>
  Effect.gen(function* () {
    const { describe, prompts } = harness([offCanvas, { nonsense: true }]);
    const error = yield* describe("A pink fairy").pipe(Effect.flip);
    expect(error._tag).toBe("TotError");
    expect(error.message).toMatch(/still invalid after a retry/);
    expect(prompts).toHaveLength(2);
  }),
);

it.effect("renames a figure that takes a built-in id", () =>
  Effect.gen(function* () {
    const { describe } = harness([{ ...fairy, id: "mug" }]);
    const result = yield* describe("A mug");
    expect(result.figure.id).toBe("mug-new");
  }),
);

it.effect("tries the first allowed usage-limit fallback once when the model fails", () =>
  Effect.gen(function* () {
    const banned: ModelSelection = {
      instanceId: ProviderInstanceId.make("opencode"),
      model: "opencode-go/glm-5.3",
    };
    const flash: ModelSelection = {
      instanceId: ProviderInstanceId.make("opencode"),
      model: "opencode-go/glm-5.3-flash",
    };
    const { describe, models } = harness(
      [
        new TextGenerationError({ operation: "generateAvatarFigure", detail: "usage limit" }),
        fairy,
      ],
      { usageLimitFallbackModels: [banned, flash] },
    );
    const result = yield* describe("A pink fairy");
    expect(result.figure).toEqual(fairy);
    expect(models).toMatchObject([cheap, flash]);
  }),
);

it.effect("never runs full GLM 5.3 on OpenCode Go", () =>
  Effect.gen(function* () {
    const goApi = ProviderInstanceId.make("opencode-go-api");
    const { describe, prompts } = harness([fairy], {
      textGenerators: {
        [goApi]: { kind: "openaiCompatible", baseUrl: "http://127.0.0.1:18999/v1", enabled: true },
      },
      avatarDesignModelSelection: { instanceId: goApi, model: "opencode-go/glm-5.3" },
    });
    const error = yield* describe("A pink fairy").pipe(Effect.flip);
    expect(error.message).toMatch(/is not allowed here/);
    expect(prompts).toEqual([]);
  }),
);
