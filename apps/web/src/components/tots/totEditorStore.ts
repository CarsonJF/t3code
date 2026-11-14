import type { EnvironmentId, Tot } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { usePrimaryEnvironmentId } from "~/state/environments";
import { useTots } from "~/state/tots";

export type TotEditorTarget =
  | { readonly mode: "create"; readonly environmentId: EnvironmentId }
  | { readonly mode: "edit"; readonly environmentId: EnvironmentId; readonly tot: Tot };

// One editor for the whole app: the sidebar button, Settings and the command palette open it.
let current: TotEditorTarget | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function openTotEditor(target: TotEditorTarget): void {
  current = target;
  notify();
}

export function closeTotEditor(): void {
  current = null;
  notify();
}

export function useTotEditorTarget(): TotEditorTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

/** Where new Tots go: the environment that already hosts Tots, else this one. */
export function useTotHostEnvironmentId(): EnvironmentId | null {
  const tots = useTots();
  const primary = usePrimaryEnvironmentId();
  return tots[0]?.environmentId ?? primary;
}
