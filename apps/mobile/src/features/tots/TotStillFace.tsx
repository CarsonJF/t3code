import { totStillHeadPath } from "@t3tools/client-runtime/tots/shapes";
import type { TotAvatar, TotFaceState } from "@t3tools/contracts";
import Svg, { Path, Rect } from "react-native-svg";

const EYE = "#F8FAFC";

/** The eyes BoopFace holds for each state, drawn on a 100x100 head. */
function Eyes(props: { readonly state: TotFaceState }) {
  switch (props.state) {
    case "working":
      // Looking to one side, as the waiting spin passes.
      return (
        <>
          <Rect x={30} y={38} width={12} height={24} rx={6} fill={EYE} />
          <Rect x={58} y={38} width={12} height={24} rx={6} fill={EYE} />
        </>
      );
    case "needs-you":
      // Wary: narrowed eyes.
      return (
        <>
          <Rect x={24} y={46} width={16} height={9} rx={4.5} fill={EYE} />
          <Rect x={60} y={46} width={16} height={9} rx={4.5} fill={EYE} />
        </>
      );
    case "success":
      // Smiling eyes.
      return (
        <>
          <Path
            d="M24 56 Q32 42 40 56"
            stroke={EYE}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M60 56 Q68 42 76 56"
            stroke={EYE}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    case "failure":
      // Drooped eyes.
      return (
        <>
          <Path d="M24 54 L40 60" stroke={EYE} strokeWidth={7} strokeLinecap="round" />
          <Path d="M60 60 L76 54" stroke={EYE} strokeWidth={7} strokeLinecap="round" />
        </>
      );
    case "sleep":
      return (
        <>
          <Path d="M24 54 L40 54" stroke={EYE} strokeWidth={6} strokeLinecap="round" />
          <Path d="M60 54 L76 54" stroke={EYE} strokeWidth={6} strokeLinecap="round" />
        </>
      );
    case "idle":
      return (
        <>
          <Rect x={26} y={38} width={13} height={24} rx={6.5} fill={EYE} />
          <Rect x={61} y={38} width={13} height={24} rx={6.5} fill={EYE} />
        </>
      );
  }
}

/** A Tot's face holding the pose for its state, for lists where nothing should move. */
export function TotStillFace(props: {
  readonly avatar: TotAvatar;
  readonly state: TotFaceState;
  readonly size: number;
}) {
  const head = totStillHeadPath(props.avatar.shape);
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 100 100" accessibilityElementsHidden>
      {head === null ? (
        <Rect x={6} y={10} width={88} height={80} rx={30} fill={props.avatar.color} />
      ) : (
        <Path d={head} fill={props.avatar.color} />
      )}
      <Eyes state={props.state} />
    </Svg>
  );
}
