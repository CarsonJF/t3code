// Runs inside the Tot face WebView: one BoopFace that the app drives by message.
import "boopface";
import { applyTotHeadShape } from "@t3tools/client-runtime/tots/shapes";
import type { TotShape } from "@t3tools/contracts";

interface FaceMessage {
  readonly action: string;
  readonly color: string;
  readonly skin?: number;
  readonly shape?: TotShape;
  readonly size: number;
  readonly motion: "auto" | "reduce";
}

interface BoopFaceElement extends HTMLElement {
  play(action: string): unknown;
  setPointerFollow(enabled?: boolean): unknown;
}

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
