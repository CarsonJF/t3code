import {
  type ModelSelection,
  type TotAvatar,
  type TotCreateInput,
  type TotId,
  type TotScope,
  type TotShape,
  totSlug,
} from "@t3tools/contracts";

/** What the Tot editor holds while the user fills it in, on web and mobile. */
export interface TotDraft {
  readonly name: string;
  readonly color: string;
  readonly skin: number | null;
  readonly shape?: TotShape;
  readonly scope: TotScope;
  readonly instructions: string;
  readonly modelSelection: ModelSelection;
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
  };
  return {
    ok: true,
    value: {
      name,
      avatar,
      scope: draft.scope,
      instructions: draft.instructions,
      modelSelection: draft.modelSelection,
    },
  };
}
