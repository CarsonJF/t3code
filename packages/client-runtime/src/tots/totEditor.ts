import {
  type ModelSelection,
  type TotAccessory,
  type TotAvatar,
  type TotAvatarStyle,
  type TotCreateInput,
  type TotId,
  type TotOpenBotAvatar,
  type TotScope,
  type TotShape,
  type TotTemplate,
  totSlug,
} from "@t3tools/contracts";

/** What the Tot editor holds while the user fills it in, on web and mobile. */
export interface TotDraft {
  readonly name: string;
  readonly color: string;
  readonly skin: number | null;
  readonly shape?: TotShape;
  readonly antenna?: boolean;
  readonly accessories?: ReadonlyArray<TotAccessory>;
  readonly style?: TotAvatarStyle | undefined;
  readonly openBot?: TotOpenBotAvatar | undefined;
  readonly scope: TotScope;
  readonly instructions: string;
  readonly modelSelection: ModelSelection;
  /** A built-in template id; creating the Tot also adds that template's routines, paused. */
  readonly template?: string | undefined;
  readonly memoryTidy?: boolean | undefined;
}

export type TotDraftErrors = Partial<Record<"name" | "color" | "scope", string>>;

export type TotDraftResult =
  | { readonly ok: true; readonly value: TotCreateInput }
  | { readonly ok: false; readonly errors: TotDraftErrors };

/**
 * Checks a draft before it is sent. `existingIds` are the Tots already on that
 * environment; `editing` is the Tot being edited, which may keep its own name.
 */
export function validateTotDraft(
  draft: TotDraft,
  existingIds: ReadonlyArray<TotId>,
  editing: TotId | null,
): TotDraftResult {
  const errors: { name?: string; color?: string; scope?: string } = {};
  const name = draft.name.trim();
  const slug = totSlug(name);
  if (name === "" || slug === null) errors.name = "Give the Tot a name.";
  else if (name.length > 40) errors.name = "Keep the name under 40 characters.";
  else if (slug !== editing && existingIds.includes(slug)) {
    errors.name = "A Tot named like this already exists.";
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) errors.color = "Pick a color like #0A7EA4.";
  if (draft.scope !== "all" && draft.scope.projects.length + draft.scope.groups.length === 0) {
    errors.scope = "Pick at least one project, or Everything.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const avatar: TotAvatar = {
    color: draft.color,
    ...(draft.skin === null ? {} : { skin: draft.skin }),
    ...(draft.shape === undefined || draft.shape === "round" ? {} : { shape: draft.shape }),
    ...(draft.antenna === true ? { antenna: true } : {}),
    ...(draft.accessories === undefined || draft.accessories.length === 0
      ? {}
      : { accessories: draft.accessories }),
    ...(draft.style === "open-bot" ? { style: draft.style } : {}),
    ...(draft.openBot === undefined ? {} : { openBot: draft.openBot }),
  };
  return {
    ok: true,
    value: {
      name,
      avatar,
      scope: draft.scope,
      instructions: draft.instructions,
      modelSelection: draft.modelSelection,
      ...(draft.template === undefined ? {} : { template: draft.template }),
      ...(draft.memoryTidy === undefined ? {} : { memoryTidy: draft.memoryTidy }),
    },
  };
}

/** Fills a new Tot's draft from a template, keeping a name the user typed themselves. */
export function applyTotTemplate<
  Draft extends Pick<TotDraft, "name" | "instructions" | "scope" | "template">,
>(draft: Draft, template: TotTemplate, previous: TotTemplate | undefined): Draft {
  const keepName = draft.name.trim() !== "" && draft.name !== previous?.name;
  return {
    ...draft,
    name: keepName ? draft.name : template.id === "blank" ? "" : template.name,
    instructions: template.instructions,
    scope:
      template.scope === "all"
        ? "all"
        : draft.scope === "all"
          ? { projects: [], groups: [] }
          : draft.scope,
    template: template.id,
  };
}
