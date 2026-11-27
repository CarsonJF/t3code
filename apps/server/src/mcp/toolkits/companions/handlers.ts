import {
  type ExternalCompanionConfig,
  OrchestratorMcpFailure,
  type TotThemePatch,
} from "@t3tools/contracts";
import { companionThemeSelector, mergeTheme, totThemeProblem } from "@t3tools/shared/totTheme";
import * as Effect from "effect/Effect";

import * as Settings from "../../../serverSettings.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { CompanionThemeToolkit } from "./tools.ts";

/** Sizes and a summary only, as for a Tot: the stored CSS and effect are never echoed. */
const themeResult = (companion: ExternalCompanionConfig) => {
  const cssLength = companion.theme?.css?.length ?? 0;
  const effectLength = companion.theme?.effect?.length ?? 0;
  return {
    companionId: companion.id,
    selector: companionThemeSelector(companion.id),
    cssLength,
    effectLength,
    summary: [
      cssLength === 0 ? "No CSS" : `${cssLength} characters of CSS`,
      effectLength === 0 ? "no effect" : `an effect of ${effectLength} characters`,
    ].join(", "),
  };
};

const noCompanion = (companionId: string) =>
  new OrchestratorMcpFailure({
    code: "invalid_request",
    message: `There is no companion "${companionId}" in Settings → External Companions.`,
  });

export const layer = McpToolAccess.toLayer(CompanionThemeToolkit, {
  t3_companion_theme_read: McpToolAccess.reads(({ companionId }) =>
    Effect.gen(function* () {
      const settings = yield* (yield* Settings.ServerSettingsService).getSettings.pipe(
        Effect.mapError(() => unavailable()),
      );
      const companion = settings.externalCompanions.find((entry) => entry.id === companionId);
      if (companion === undefined) return yield* noCompanion(companionId);
      return themeResult(companion);
    }),
  ),
  t3_companion_theme_set: McpToolAccess.writesEnvironment(({ companionId, css, effect }) =>
    Effect.gen(function* () {
      const patch: TotThemePatch = {
        ...(css === undefined ? {} : { css }),
        ...(effect === undefined ? {} : { effect }),
      };
      const problem = totThemeProblem(patch);
      if (problem !== null)
        return yield* new OrchestratorMcpFailure({ code: "invalid_request", message: problem });
      const service = yield* Settings.ServerSettingsService;
      const current = yield* service.getSettings.pipe(Effect.mapError(() => unavailable()));
      if (!current.externalCompanions.some((entry) => entry.id === companionId))
        return yield* noCompanion(companionId);
      const next = yield* service
        .updateExternalCompanions((companions) =>
          companions.map((companion) => {
            if (companion.id !== companionId) return companion;
            const { theme: previous, ...rest } = companion;
            const theme = mergeTheme(previous, patch);
            return theme === undefined ? rest : { ...rest, theme };
          }),
        )
        .pipe(Effect.mapError(() => unavailable()));
      const updated = next.externalCompanions.find((entry) => entry.id === companionId);
      if (updated === undefined) return yield* noCompanion(companionId);
      return themeResult(updated);
    }),
  ),
});
