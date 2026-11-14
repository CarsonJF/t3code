import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
} from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useTots } from "~/state/tots";
import { TotAvatar } from "./TotAvatar";

/** A Tot's face in its own thread's header, fully animated; nothing for other threads. */
export function TotThreadFace(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const tots = useTots();
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const entry = tots.find(
    (candidate) =>
      candidate.environmentId === props.environmentId && candidate.tot.threadId === props.threadId,
  );
  const shell = useThreadShell(
    entry === undefined ? null : scopeThreadRef(props.environmentId, props.threadId),
  );
  if (entry === undefined) return null;
  return (
    <TotAvatar
      avatar={entry.tot.avatar}
      state={totFaceState(totFaceInputFromShell(entry.tot, shell))}
      animation={resolveTotAnimation("own-view", animate, reducedMotion)}
      size={22}
    />
  );
}
