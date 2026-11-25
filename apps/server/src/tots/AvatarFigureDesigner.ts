import {
  ALWAYS_DENIED_FALLBACK_MODELS,
  AvatarFigure,
  TotError,
  type AvatarFigureDescribeResult,
  type ModelSelection,
} from "@t3tools/contracts";
import { resolveAvatarDesignModelSelection } from "@t3tools/shared/serverSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { renderAvatarSvg, validateAvatar } from "open-bot-avatar";
import { designPrompt } from "open-bot-avatar/prompt";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { chooseUsageLimitFallback } from "../orchestration-v2/UsageLimitFallback.ts";
import { BUILT_IN_FIGURE_IDS } from "./avatarLibrary.ts";

/** Turns a description into a validated open-bot figure, without saving it. */
export class AvatarFigureDesigner extends Context.Service<
  AvatarFigureDesigner,
  {
    readonly describe: (description: string) => Effect.Effect<AvatarFigureDescribeResult, TotError>;
  }
>()("t3/tots/AvatarFigureDesigner") {}

const decodeFigure = Schema.decodeUnknownOption(AvatarFigure);
const isTotError = Schema.is(TotError);

/** The renderer's own complaints, or the contract's when the shape is wrong before that. */
export const figureErrors = (draft: unknown): ReadonlyArray<string> => {
  const result = validateAvatar(draft);
  if (!result.ok) return result.errors;
  return decodeFigure(draft)._tag === "Some"
    ? []
    : ["The definition breaks the schema: check id, name (≤ 40 characters) and eye ranges."];
};

/**
 * One prompt for runners that take a single message: the vendored design prompt as the
 * instructions, then the description, and on a retry the rejected answer and its errors.
 */
const designRequest = (
  description: string,
  rejected?: { readonly answer: unknown; readonly errors: ReadonlyArray<string> },
): string =>
  [
    designPrompt.trim(),
    "---",
    `Create one avatar definition from this description: ${description}`,
    ...(rejected === undefined
      ? []
      : [
          `Your previous answer was rejected:\n${JSON.stringify(rejected.answer)}`,
          `The engine reported:\n${rejected.errors.map((error) => `- ${error}`).join("\n")}`,
          "Fix every problem and answer again.",
        ]),
    "Return only the JSON definition, nothing else.",
  ].join("\n\n");

const isDenied = (selection: ModelSelection, denied: ReadonlyArray<string>) =>
  [...ALWAYS_DENIED_FALLBACK_MODELS, ...denied].some(
    (entry) => entry.trim().toLowerCase() === selection.model.trim().toLowerCase(),
  );

/** A built-in figure keeps its id; a generated one that takes it gets a suffix instead. */
const freeId = (figure: AvatarFigure, taken: ReadonlySet<string>): AvatarFigure =>
  taken.has(figure.id) ? { ...figure, id: `${figure.id.slice(0, 44)}-new` } : figure;

const make = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration.TextGeneration;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const fileSystem = yield* FileSystem.FileSystem;

  const describe = Effect.fn("AvatarFigureDesigner.describe")(
    function* (description: string) {
      const settings = yield* settingsService.getSettings;
      const providers = yield* providerRegistry.getProviders;
      const denied = settings.usageLimitFallbackDeniedModels;
      const chosen = resolveAvatarDesignModelSelection(settings, providers);
      if (isDenied(chosen, denied)) {
        return yield* new TotError({
          message: `${chosen.model} is not allowed here. Pick another shape model in Settings → Avatar library.`,
        });
      }
      // Providers run in a working directory; designing a shape must not read a checkout.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-avatar-design-" });
      const generate = (modelSelection: ModelSelection, prompt: string) =>
        textGeneration.generateAvatarFigure({ cwd, prompt, modelSelection });
      // Like scheduled work, a failed call gets one try on the first allowed fallback model.
      const fallback = chooseUsageLimitFallback({
        candidates: settings.usageLimitFallbackModels,
        denied,
        failed: chosen,
      });
      let model = chosen;
      const attempt = (prompt: string) =>
        generate(model, prompt).pipe(
          Effect.catch((error) =>
            fallback === null || model === fallback
              ? Effect.fail(error)
              : Effect.suspend(() => {
                  model = fallback;
                  return generate(fallback, prompt);
                }),
          ),
        );

      let draft: unknown = yield* attempt(designRequest(description));
      let errors = figureErrors(draft);
      if (errors.length > 0) {
        draft = yield* attempt(designRequest(description, { answer: draft, errors }));
        errors = figureErrors(draft);
      }
      const decoded = decodeFigure(draft);
      if (errors.length > 0 || decoded._tag === "None") {
        return yield* new TotError({
          message: `The model's shape was still invalid after a retry: ${errors.slice(0, 3).join(" ")}`,
        });
      }
      const figure = freeId(decoded.value, BUILT_IN_FIGURE_IDS);
      return { figure, previewSvg: renderAvatarSvg(figure, { size: 160 }) };
    },
    Effect.scoped,
    Effect.mapError((cause) =>
      isTotError(cause)
        ? cause
        : new TotError({
            message:
              "detail" in cause && typeof cause.detail === "string"
                ? `The shape could not be generated: ${cause.detail}`
                : "The shape could not be generated.",
          }),
    ),
  );

  return AvatarFigureDesigner.of({ describe });
});

export const layer = Layer.effect(AvatarFigureDesigner, make);
