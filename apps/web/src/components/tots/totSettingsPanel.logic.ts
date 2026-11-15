import {
  parseTotThreadId,
  TOT_THEME_MAX_LENGTH,
  totWatchReportsOf,
  type ScheduledTask,
  type ScheduledTaskWebhookFilter,
  type Tot,
  type TotAvatar,
  type TotScope,
  type TotWatchReports,
} from "@t3tools/contracts";
import { totThemeProblem } from "@t3tools/shared/totTheme";

export interface TotThemeDraft {
  readonly css: string;
  readonly effect: string;
}

export interface TotSettingsDraft {
  readonly name: string;
  readonly avatar: TotAvatar;
  readonly scope: TotScope;
  readonly instructions: string;
  readonly theme: TotThemeDraft;
  readonly watchReports: TotWatchReports;
}

export type TotSettingsDraftErrors = Partial<
  Record<"name" | "color" | "scope" | "themeCss" | "themeEffect", string>
>;

export function totSettingsDraftFromTot(tot: Tot): TotSettingsDraft {
  return {
    name: tot.name,
    avatar: tot.avatar,
    scope: tot.scope,
    instructions: tot.instructions,
    theme: { css: tot.theme?.css ?? "", effect: tot.theme?.effect ?? "" },
    watchReports: totWatchReportsOf(tot),
  };
}

const normalizedScope = (scope: TotScope): TotScope =>
  scope === "all"
    ? "all"
    : {
        projects: scope.projects
          .map((entry) => ({
            environmentId: entry.environmentId,
            projectId: entry.projectId,
          }))
          .sort((left, right) =>
            `${left.environmentId}:${left.projectId}`.localeCompare(
              `${right.environmentId}:${right.projectId}`,
            ),
          ),
        groups: [...scope.groups].sort(),
      };

/** Compares what the panel shows, not object identity. */
export function totSettingsDraftKey(draft: TotSettingsDraft): string {
  return JSON.stringify({
    name: draft.name,
    avatar: [
      draft.avatar.color.toLowerCase(),
      draft.avatar.skin ?? null,
      draft.avatar.shape ?? "round",
      draft.avatar.antenna === true,
    ],
    scope: normalizedScope(draft.scope),
    instructions: draft.instructions,
    theme: draft.theme,
    watchReports: draft.watchReports,
  });
}

export function totSettingsDraftErrors(draft: TotSettingsDraft): TotSettingsDraftErrors {
  const errors: TotSettingsDraftErrors = {};
  const name = draft.name.trim();
  if (name === "") errors.name = "Give the Tot a name.";
  else if (name.length > 40) errors.name = "Keep the name under 40 characters.";
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.avatar.color)) {
    errors.color = "Pick a color like #0A7EA4.";
  }
  if (draft.scope !== "all" && draft.scope.projects.length + draft.scope.groups.length === 0) {
    errors.scope = "Pick at least one project or group, or Everything.";
  }
  // The server runs the same checks; this is the early answer in the panel.
  const cssProblem = totThemeProblem({ css: draft.theme.css });
  if (cssProblem !== null) {
    errors.themeCss =
      draft.theme.css.length > TOT_THEME_MAX_LENGTH
        ? `Keep the CSS under ${TOT_THEME_MAX_LENGTH.toLocaleString()} characters.`
        : "CSS cannot load files. Use data: or #id for url().";
  }
  if (draft.theme.effect.length > TOT_THEME_MAX_LENGTH) {
    errors.themeEffect = `Keep the effect under ${TOT_THEME_MAX_LENGTH.toLocaleString()} characters.`;
  }
  return errors;
}

export function totSettingsDraftUpdate(draft: TotSettingsDraft): TotSettingsDraft {
  return {
    name: draft.name.trim(),
    avatar: draft.avatar,
    scope: draft.scope,
    instructions: draft.instructions,
    theme: { css: draft.theme.css, effect: draft.theme.effect },
    watchReports: draft.watchReports,
  };
}

/** The watch-reports choices: label in the select, and the one-line help shown under it. */
export const WATCH_REPORTS: Record<
  TotWatchReports,
  { readonly label: string; readonly help: string }
> = {
  launched: {
    label: "Launched threads only",
    help: "Reports only threads this Tot starts.",
  },
  explicit: {
    label: "Every watch",
    help: "Also reports threads it chose to watch and runs it sent to other threads.",
  },
  off: {
    label: "Off",
    help: "No reports. Its watches are kept and resume if you turn reports back on.",
  },
};

/** A Tot's routines target its own project, or one of the threads it has had. */
export function scheduledTaskBelongsToTot(
  task: Pick<ScheduledTask, "projectId" | "threadId">,
  tot: Pick<Tot, "id" | "projectId">,
): boolean {
  if (task.threadId !== null && parseTotThreadId(task.threadId) === tot.id) return true;
  return tot.projectId !== null && task.projectId === tot.projectId;
}

export function webhookFilterSummary(
  filters: ReadonlyArray<ScheduledTaskWebhookFilter> | undefined,
): string {
  if (filters === undefined || filters.length === 0) return "Any request";
  return filters
    .map((filter) => {
      if (filter.op === "exists") return `${filter.path} exists`;
      if (filter.op === "in") return `${filter.path} is one of ${filter.value.join(", ")}`;
      if (filter.op === "notEquals") return `${filter.path} ≠ ${filter.value}`;
      if (filter.op === "startsWith") return `${filter.path} starts with ${filter.value}`;
      return `${filter.path} = ${filter.value}`;
    })
    .join(" · ");
}
