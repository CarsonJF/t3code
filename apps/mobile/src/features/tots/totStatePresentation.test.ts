import { TOT_FACE_STATE_LABELS } from "@t3tools/client-runtime/tots";
import type { TotFaceState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { TOT_STATE_PRESENTATION } from "./totStatePresentation";

describe("TOT_STATE_PRESENTATION", () => {
  it("dresses every state a face can hold", () => {
    for (const state of Object.keys(TOT_FACE_STATE_LABELS) as TotFaceState[]) {
      expect(TOT_STATE_PRESENTATION[state].pillClassName).not.toBe("");
    }
  });

  it("marks only the states that are asking for him", () => {
    const urgent = (Object.keys(TOT_STATE_PRESENTATION) as TotFaceState[]).filter(
      (state) => TOT_STATE_PRESENTATION[state].urgent,
    );
    expect(urgent).toEqual(["needs-you", "failure"]);
  });

  it("paints the working state in the Tot's own colour", () => {
    expect(TOT_STATE_PRESENTATION.working.accentText).toBe(true);
    expect(TOT_STATE_PRESENTATION.idle.accentText).toBe(false);
  });
});
