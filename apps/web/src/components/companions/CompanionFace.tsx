import { companionAvatar, companionFaceState } from "@t3tools/client-runtime/companions";
import { resolveTotAnimation } from "@t3tools/client-runtime/tots";
import type { CompanionAvatar } from "@t3tools/contracts";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { TotAvatar } from "../tots/TotAvatar";

/** A companion's or child's open-bot face, with T3's fallback when its descriptor is missing. */
export function CompanionFace(props: {
  readonly avatar: CompanionAvatar | undefined;
  readonly seed: string;
  readonly state: string | undefined;
  readonly online: boolean;
  readonly size: number;
  readonly hovered?: boolean;
}) {
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <TotAvatar
      avatar={companionAvatar(props.avatar, props.seed)}
      state={companionFaceState(props.state, props.online)}
      animation={resolveTotAnimation("sidebar-row", animate, reducedMotion)}
      size={props.size}
      hovered={props.hovered === true}
    />
  );
}
