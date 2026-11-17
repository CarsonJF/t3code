// Runs inside the Tot face WebView: one BoopFace that the app drives by message.
import { listAccessories } from "boopface";
import {
  totAccessoryFit,
  totHeadBox,
  totWearableAccessories,
  type TotAccessoryFrame,
} from "@t3tools/client-runtime/tots/accessories";
import { applyTotAntenna, applyTotHeadShape } from "@t3tools/client-runtime/tots/shapes";
import type { TotAccessory, TotShape } from "@t3tools/contracts";

interface FaceMessage {
  readonly action: string;
  readonly color: string;
  readonly skin?: number;
  readonly shape?: TotShape;
  readonly antenna?: boolean;
  readonly accessories?: ReadonlyArray<TotAccessory>;
  readonly size: number;
  readonly motion: "auto" | "reduce";
}

interface BoopFaceElement extends HTMLElement {
  play(action: string): unknown;
  setPointerFollow(enabled?: boolean): unknown;
  setAccessories(accessories: ReadonlyArray<TotAccessory>): unknown;
}

// The component's own frame: a 240 box with the head centred on 120,120.
const FRAME: TotAccessoryFrame = {
  head: totHeadBox(undefined),
  unit: 1,
  centreX: 120,
  eyeY: 126,
};

/** A hat or halo reaches past the component, so the face shrinks inside the WebView to fit. */
const fitFace = (face: BoopFaceElement, message: FaceMessage) => {
  const fit = totAccessoryFit(
    { ...FRAME, head: totHeadBox(message.shape) },
    message.accessories ?? [],
    { width: 240, height: 240 },
    5,
  );
  face.style.transformOrigin = "0 0";
  face.style.transform =
    fit === null
      ? ""
      : `translate(${(fit.x / 240) * message.size}px, ${(fit.y / 240) * message.size}px) scale(${fit.scale})`;
};

const face = document.createElement("boop-face") as BoopFaceElement;
face.setAttribute("auto-sleep", "0");
face.setAttribute("wake-on", "manual");
face.setAttribute("press-squeeze", "false");
face.setAttribute("antenna-drag", "false");
document.body.style.margin = "0";
document.body.style.background = "transparent";
document.body.style.display = "flex";
document.body.style.alignItems = "center";
document.body.style.justifyContent = "center";
document.body.append(face);

const apply = (message: FaceMessage) => {
  face.setAttribute("size", String(message.size));
  face.setAttribute("color", message.color);
  if (message.skin === undefined) face.removeAttribute("skin");
  else face.setAttribute("skin", String(message.skin));
  face.setAttribute("motion", message.motion);
  applyTotHeadShape(face, message.shape);
  applyTotAntenna(face, message.antenna === true);
  face.setAccessories(totWearableAccessories(message.accessories, listAccessories()));
  fitFace(face, message);
  face.setPointerFollow(false);
  face.play(message.action);
};

const receive = (event: Event) => {
  const data = (event as MessageEvent<unknown>).data;
  if (typeof data !== "string") return;
  try {
    apply(JSON.parse(data) as FaceMessage);
  } catch {
    // Not a face message.
  }
};

// iOS delivers postMessage on window, Android on document.
window.addEventListener("message", receive);
document.addEventListener("message", receive);
const initial = (window as { __TOT_FACE__?: FaceMessage }).__TOT_FACE__;
if (initial !== undefined) apply(initial);
