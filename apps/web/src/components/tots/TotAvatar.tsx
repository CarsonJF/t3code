import type { TotAnimation } from "@t3tools/client-runtime/tots";
import {
  totAccessoryFit,
  totHeadBox,
  totWearableAccessories,
  type TotAccessoryFrame,
} from "@t3tools/client-runtime/tots/accessories";
import { applyTotAntenna, applyTotHeadShape } from "@t3tools/client-runtime/tots/shapes";
import {
  TOT_FACE_ACTION,
  totAvatarStyleOf,
  type TotAccessory,
  type TotAvatar as TotAvatarValue,
  type TotFaceState,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { OpenBotFace, useOpenBotKit } from "./OpenBotFace";

interface BoopFaceElement extends HTMLElement {
  play(action: string): unknown;
  setPointerFollow(enabled?: boolean): unknown;
  setAccessories(accessories: ReadonlyArray<TotAccessory>): unknown;
}

// One import for the page; the full build loads skin painting only when a skin is used.
let boopFaceLoad: Promise<typeof import("boopface")> | null = null;
export const loadBoopFace = () => (boopFaceLoad ??= import("boopface"));
const isDefined = () =>
  typeof customElements !== "undefined" && customElements.get("boop-face") !== undefined;

/** BoopFace's own coordinates: a 240 box with the head centred on 120,120. */
const FACE_FRAME = (shape: TotAvatarValue["shape"]): TotAccessoryFrame => ({
  head: totHeadBox(shape),
  unit: 1,
  centreX: 120,
  eyeY: 126,
});

interface TotAvatarProps {
  readonly avatar: TotAvatarValue;
  readonly state: TotFaceState;
  readonly animation: TotAnimation;
  readonly size: number;
  readonly hovered?: boolean;
}

/** A Tot's face in its chosen style; BoopFace when open-bot has no figure by that id. */
export function TotAvatar(props: TotAvatarProps) {
  const openBot = totAvatarStyleOf(props.avatar) === "open-bot" ? props.avatar.openBot : undefined;
  const kit = useOpenBotKit(openBot !== undefined);
  if (openBot === undefined) return <BoopFaceAvatar {...props} />;
  if (kit === null) {
    return (
      <span
        aria-hidden="true"
        style={{ display: "inline-block", width: props.size, height: props.size, flexShrink: 0 }}
      />
    );
  }
  const figure = kit.figures.find((entry) => entry.id === openBot.figure);
  if (figure === undefined) return <BoopFaceAvatar {...props} />;
  return (
    <OpenBotFace
      kit={kit}
      figure={figure}
      look={openBot}
      color={props.avatar.color}
      state={props.state}
      moving={props.animation === "full" || (props.animation === "hover" && props.hovered === true)}
      size={props.size}
    />
  );
}

function BoopFaceAvatar(props: TotAvatarProps) {
  const ref = useRef<BoopFaceElement | null>(null);
  const [defined, setDefined] = useState(isDefined);
  const moving =
    props.animation === "full" || (props.animation === "hover" && props.hovered === true);
  const accessories = props.avatar.accessories ?? [];
  // A hat or halo reaches past the component's box; shrink a face inside its square so it fits.
  const fit =
    accessories.length === 0
      ? null
      : totAccessoryFit(
          FACE_FRAME(props.avatar.shape),
          accessories,
          { width: 240, height: 240 },
          5,
        );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the boop-face custom element once
  useEffect(() => {
    if (defined) return;
    let cancelled = false;
    void loadBoopFace().then(() => {
      if (!cancelled) setDefined(true);
    });
    return () => {
      cancelled = true;
    };
  }, [defined]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the boop-face element's expression
  useEffect(() => {
    const face = ref.current;
    if (!defined || face === null) return;
    face.setPointerFollow(false);
    face.play(TOT_FACE_ACTION[props.state]);
  }, [defined, props.state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the outline into the boop-face element
  useEffect(() => {
    const face = ref.current;
    if (!defined || face === null) return;
    applyTotHeadShape(face, props.avatar.shape);
  }, [defined, props.avatar.shape]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hides or shows the boop-face antenna in its shadow root
  useEffect(() => {
    const face = ref.current;
    if (!defined || face === null) return;
    applyTotAntenna(face, props.avatar.antenna === true);
  }, [defined, props.avatar.antenna]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- dresses the boop-face element in the accessories its catalog knows
  useEffect(() => {
    const face = ref.current;
    if (!defined || face === null) return;
    let cancelled = false;
    void loadBoopFace().then((module) => {
      if (cancelled || ref.current !== face) return;
      face.setAccessories(
        totWearableAccessories(props.avatar.accessories, module.listAccessories()),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [defined, props.avatar.accessories]);

  return (
    <boop-face
      ref={ref}
      aria-hidden="true"
      data-tot-state={props.state}
      size={String(props.size)}
      color={props.avatar.color}
      {...(props.avatar.skin === undefined ? {} : { skin: String(props.avatar.skin) })}
      motion={moving ? "auto" : "reduce"}
      auto-sleep="0"
      wake-on="manual"
      press-squeeze="false"
      antenna-drag="false"
      style={{
        display: "inline-block",
        width: props.size,
        height: props.size,
        flexShrink: 0,
        ...(fit === null
          ? {}
          : {
              transform: `translate(${(fit.x / 240) * props.size}px, ${(fit.y / 240) * props.size}px) scale(${fit.scale})`,
              transformOrigin: "0 0",
            }),
      }}
    />
  );
}
