import {
  TOT_GLASSES_ART,
  TOT_HALO_ART,
  TOT_TOP_HAT_ART,
  totAccessoryColor,
  totAccessoryFit,
  totAccessoryPoint,
  totAccessoryShape,
  totAccessoryTransform,
  totGlassesBridgePath,
  totGlassesPlacement,
  totHaloPlacement,
  totHeadBoxIn,
  totTopHatBandPath,
  totTopHatCrownPath,
  totTopHatPlacement,
  type TotAccessoryFrame,
} from "@t3tools/client-runtime/tots/accessories";
import { totStillHeadPath } from "@t3tools/client-runtime/tots/shapes";
import type { TotAccessory, TotAvatar, TotFaceState, TotShape } from "@t3tools/contracts";
import Svg, { Ellipse, G, Path, Rect } from "react-native-svg";

const EYE = "#F8FAFC";

/** The face size every Tot row uses, so a Tot looks the same wherever it is listed. */
export const TOT_ROW_FACE_SIZE = 30;

/** How the still face maps BoopFace's 240 box into its 100 box. */
const UNIT = 0.44;
const ROUND_HEAD = { x: 6, y: 10, width: 88, height: 80 };

const stillFrame = (shape: TotShape | undefined): TotAccessoryFrame => ({
  head:
    shape === undefined || shape === "round"
      ? ROUND_HEAD
      : totHeadBoxIn(shape, { x: 50, y: 50 }, UNIT),
  unit: UNIT,
  centreX: 50,
  eyeY: 50,
});

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

/** The same accessories BoopFace draws, anchored to this face's own head and eyes. */
function Accessory(props: { readonly accessory: TotAccessory; readonly frame: TotAccessoryFrame }) {
  const { accessory, frame } = props;
  const shape = totAccessoryShape(accessory.kind);
  if (shape === null) return null;
  const color = totAccessoryColor(accessory);
  switch (shape) {
    case "top-hat": {
      const hat = totTopHatPlacement(frame);
      return (
        <G transform={totAccessoryTransform(hat)}>
          <Ellipse
            cx={0}
            cy={0}
            rx={TOT_TOP_HAT_ART.brim.rx}
            ry={TOT_TOP_HAT_ART.brim.ry}
            fill={color}
          />
          <Path d={totTopHatCrownPath()} fill={color} />
          <Path d={totTopHatBandPath()} fill="#fff" fillOpacity={TOT_TOP_HAT_ART.bandOpacity} />
          <Ellipse
            cx={TOT_TOP_HAT_ART.sheen.cx}
            cy={TOT_TOP_HAT_ART.sheen.cy}
            rx={TOT_TOP_HAT_ART.sheen.rx}
            ry={TOT_TOP_HAT_ART.sheen.ry}
            fill="#fff"
            fillOpacity={TOT_TOP_HAT_ART.sheenOpacity}
          />
        </G>
      );
    }
    case "glasses": {
      const glasses = totGlassesPlacement(frame);
      const left = totAccessoryPoint(glasses, TOT_GLASSES_ART.temples.left);
      const right = totAccessoryPoint(glasses, TOT_GLASSES_ART.temples.right);
      const lens = TOT_GLASSES_ART.lens;
      return (
        <>
          <G transform={totAccessoryTransform(glasses)} fill="none">
            {[lens.left, lens.left + lens.width + TOT_GLASSES_ART.gap].map((x) => (
              <Rect
                key={x}
                x={x}
                y={lens.top}
                width={lens.width}
                height={lens.height}
                rx={lens.radius}
                fill={color}
                fillOpacity={TOT_GLASSES_ART.fillOpacity}
                stroke={color}
                strokeWidth={TOT_GLASSES_ART.strokeWidth}
              />
            ))}
            <Path
              d={totGlassesBridgePath()}
              stroke={color}
              strokeLinecap="round"
              strokeWidth={TOT_GLASSES_ART.bridge.width}
            />
            {TOT_GLASSES_ART.highlights.map((highlight) => (
              <Path
                key={highlight.from.x}
                d={`M ${highlight.from.x} ${highlight.from.y} L ${highlight.to.x} ${highlight.to.y}`}
                stroke="#fff"
                strokeOpacity={TOT_GLASSES_ART.highlightOpacity}
                strokeWidth={TOT_GLASSES_ART.highlightWidth}
              />
            ))}
          </G>
          <Path
            d={`M ${left.x} ${left.y} L ${glasses.leftTempleEnd.x} ${glasses.leftTempleEnd.y}`}
            stroke={color}
            strokeWidth={TOT_GLASSES_ART.temples.width}
            strokeLinecap="round"
          />
          <Path
            d={`M ${right.x} ${right.y} L ${glasses.rightTempleEnd.x} ${glasses.rightTempleEnd.y}`}
            stroke={color}
            strokeWidth={TOT_GLASSES_ART.temples.width}
            strokeLinecap="round"
          />
        </>
      );
    }
    case "halo": {
      const halo = totHaloPlacement(frame);
      return (
        <G transform={totAccessoryTransform(halo)} fill="none">
          <Ellipse
            cx={0}
            cy={0}
            rx={TOT_HALO_ART.rx}
            ry={TOT_HALO_ART.ry}
            stroke={color}
            strokeWidth={TOT_HALO_ART.glowWidth}
            opacity={TOT_HALO_ART.glowOpacity}
          />
          <Ellipse
            cx={0}
            cy={0}
            rx={TOT_HALO_ART.rx}
            ry={TOT_HALO_ART.ry}
            stroke={color}
            strokeWidth={TOT_HALO_ART.strokeWidth}
          />
        </G>
      );
    }
  }
}

/** A Tot's face holding the pose for its state, for lists where nothing should move. */
export function TotStillFace(props: {
  readonly avatar: TotAvatar;
  readonly state: TotFaceState;
  readonly size: number;
}) {
  const head = totStillHeadPath(props.avatar.shape);
  const accessories = props.avatar.accessories ?? [];
  const frame = stillFrame(props.avatar.shape);
  const fit = totAccessoryFit(frame, accessories, { width: 100, height: 100 }, 2);
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 100 100" accessibilityElementsHidden>
      <G
        transform={
          fit === null
            ? undefined
            : `translate(${fit.x.toFixed(3)} ${fit.y.toFixed(3)}) scale(${fit.scale.toFixed(4)})`
        }
      >
        {head === null ? (
          <Rect
            x={ROUND_HEAD.x}
            y={ROUND_HEAD.y}
            width={ROUND_HEAD.width}
            height={ROUND_HEAD.height}
            rx={30}
            fill={props.avatar.color}
          />
        ) : (
          <Path d={head} fill={props.avatar.color} />
        )}
        <Eyes state={props.state} />
        {accessories.map((accessory) => (
          <Accessory key={accessory.kind} accessory={accessory} frame={frame} />
        ))}
      </G>
    </Svg>
  );
}
