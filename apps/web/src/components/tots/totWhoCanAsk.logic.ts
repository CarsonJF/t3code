import type { TotAskEntry } from "@t3tools/contracts";

/** A caller this environment knows by name. */
export interface TotCallerChoice {
  readonly id: string;
  readonly label: string;
}

export type TotCallerPatch = {
  readonly origin?: TotAskEntry["origin"];
  readonly id?: string;
  readonly label?: string | undefined;
  readonly mode?: TotAskEntry["mode"];
};

export type TotCallerShown =
  | { readonly kind: "anyone" }
  | { readonly kind: "known"; readonly choice: TotCallerChoice }
  | { readonly kind: "other" };

export function totCallerChoiceOf(
  entry: Pick<TotAskEntry, "id">,
  known: ReadonlyArray<TotCallerChoice>,
): TotCallerShown {
  if (entry.id === "*") return { kind: "anyone" };
  const choice = known.find((candidate) => candidate.id === entry.id);
  return choice === undefined ? { kind: "other" } : { kind: "known", choice };
}

/** The entry fields for a picked caller; a name only rides along with a known one. */
export function totCallerPick(
  value: string,
  known: ReadonlyArray<TotCallerChoice>,
): TotCallerPatch {
  const choice = known.find((candidate) => candidate.id === value);
  return choice === undefined ? { id: value } : { id: choice.id, label: choice.label };
}

/**
 * One entry after an edit. A default entry stays one while only its mode changes; a new
 * origin or caller makes it the person's own, and a new caller drops the old one's name.
 */
export function totCallerEntryPatched(entry: TotAskEntry, patch: TotCallerPatch): TotAskEntry {
  if (patch.origin === undefined && patch.id === undefined) {
    return patch.mode === undefined ? entry : { ...entry, mode: patch.mode };
  }
  const { trustedByDefault: _default, label: _label, ...own } = entry;
  const label = patch.label?.slice(0, 80);
  return {
    ...own,
    ...(patch.origin === undefined ? {} : { origin: patch.origin }),
    ...(patch.id === undefined ? {} : { id: patch.id }),
    ...(patch.mode === undefined ? {} : { mode: patch.mode }),
    ...(label === undefined || label === "" ? {} : { label }),
  };
}
