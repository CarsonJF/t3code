import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  TOT_FACE_STATE_LABELS,
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useTots } from "~/state/tots";
import { TotAvatar } from "./TotAvatar";

/** The Tot whose current thread this is, if any. */
export function useTotForThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): EnvironmentTot | undefined {
  return useTots().find(
    (candidate) => candidate.environmentId === environmentId && candidate.tot.threadId === threadId,
  );
}

/** The Tot itself, large, above its conversation: the one you are talking to. */
export function TotThreadHero(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const entry = useTotForThread(props.environmentId, props.threadId);
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const shell = useThreadShell(
    entry === undefined ? null : scopeThreadRef(props.environmentId, props.threadId),
  );
  if (entry === undefined) return null;
  const state = totFaceState(totFaceInputFromShell(entry.tot, shell));
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 border-border/60 border-b pt-5 pb-4">
      <TotAvatar
        avatar={entry.tot.avatar}
        state={state}
        animation={resolveTotAnimation("own-view", animate, reducedMotion)}
        size={104}
      />
      <span className="font-medium text-foreground text-lg">{entry.tot.name}</span>
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {TOT_FACE_STATE_LABELS[state]}
      </span>
    </div>
  );
}
