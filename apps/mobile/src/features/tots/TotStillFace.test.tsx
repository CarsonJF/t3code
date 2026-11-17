import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const svg = vi.hoisted(() => {
  const element = (name: string) => {
    const Element = (props: { readonly children?: ReactNode } & Record<string, unknown>) => {
      const { children, ...rest } = props;
      return (
        <div data-element={name} data-props={JSON.stringify(rest)}>
          {children}
        </div>
      );
    };
    return Element;
  };
  return {
    default: element("Svg"),
    G: element("G"),
    Rect: element("Rect"),
    Path: element("Path"),
    Ellipse: element("Ellipse"),
  };
});

vi.mock("react-native-svg", () => svg);

import type { TotAvatar } from "@t3tools/contracts";

import { TotStillFace } from "./TotStillFace";

interface Props {
  readonly avatar: TotAvatar;
  readonly state: "idle" | "working" | "needs-you" | "success" | "failure" | "sleep";
  readonly size: number;
}

const propsOf = (element: Element | null): Record<string, unknown> =>
  JSON.parse(element?.getAttribute("data-props") ?? "{}");

const ofKind = (container: HTMLElement, name: string): Element[] =>
  Array.from(container.querySelectorAll(`[data-element="${name}"]`));

const renderFace = async (props: Props) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<TotStillFace {...props} />));
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
    },
  };
};

const home = { color: "#0A7EA4" };

it("draws only the head and eyes when the Tot wears nothing", async () => {
  const face = await renderFace({ avatar: home, state: "idle", size: 30 });
  try {
    expect(ofKind(face.container, "Path")).toHaveLength(0);
    expect(ofKind(face.container, "Ellipse")).toHaveLength(0);
    const rects = ofKind(face.container, "Rect");
    expect(rects).toHaveLength(3);
    expect(propsOf(rects[0]!)).toMatchObject({ fill: "#0A7EA4", x: 6, y: 10 });
    // The round head needs no extra room.
    expect(propsOf(ofKind(face.container, "G")[0]!).transform).toBeUndefined();
  } finally {
    await face.cleanup();
  }
});

it("hangs a top hat on the head top and shrinks the face to make room", async () => {
  const face = await renderFace({
    avatar: { ...home, accessories: [{ kind: "top-hat" }] },
    state: "idle",
    size: 30,
  });
  try {
    const brim = ofKind(face.container, "Ellipse");
    expect(brim).toHaveLength(2);
    expect(propsOf(brim[0]!)).toMatchObject({ fill: "#191b20", rx: 62, ry: 11 });
    const crown = ofKind(face.container, "Path")[0]!;
    expect(propsOf(crown).fill).toBe("#191b20");
    expect(propsOf(crown).d).toContain("Q 0 -66");
    // The hat reaches above the head, so the whole face scales down into the square.
    const transform = String(propsOf(ofKind(face.container, "G")[0]!).transform);
    expect(transform).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\) scale\(0\./u);
  } finally {
    await face.cleanup();
  }
});

it("puts the glasses on the still face's own eye line", async () => {
  const face = await renderFace({
    avatar: { ...home, accessories: [{ kind: "glasses", color: "#262b33" }] },
    state: "idle",
    size: 30,
  });
  try {
    const lenses = ofKind(face.container, "Rect").filter(
      (rect) => propsOf(rect).stroke === "#262b33",
    );
    expect(lenses).toHaveLength(2);
    expect(propsOf(lenses[0]!)).toMatchObject({
      strokeWidth: 6,
      fillOpacity: 0.12,
      x: 54,
      y: 94,
    });
    const glasses = ofKind(face.container, "G")[1]!;
    expect(propsOf(glasses).transform).toBe("translate(50 50) scale(0.44) translate(-120 -126)");
    // The temples are drawn against the head edges, not inside the lens transform.
    const temples = ofKind(face.container, "Path").filter(
      (path) => propsOf(path).stroke === "#262b33" && String(propsOf(path).d).includes(" L "),
    );
    expect(temples.map((path) => propsOf(path).d)).toEqual([
      "M 20.08 43.84 L 12.16 41.2",
      "M 79.92 43.84 L 87.84 41.2",
    ]);
    // Glasses stay inside the head, so the face keeps its size.
    expect(propsOf(ofKind(face.container, "G")[0]!).transform).toBeUndefined();
  } finally {
    await face.cleanup();
  }
});

it("wears a namespaced catalog id and skips one this build cannot draw", async () => {
  const worn = await renderFace({
    avatar: { ...home, accessories: [{ kind: "cardinal.glasses" }] },
    state: "idle",
    size: 30,
  });
  try {
    expect(
      ofKind(worn.container, "Rect").filter((rect) => propsOf(rect).stroke === "#262b33"),
    ).toHaveLength(2);
  } finally {
    await worn.cleanup();
  }

  const unknown = await renderFace({
    avatar: { ...home, accessories: [{ kind: "cardinal.storm-cloud" }] },
    state: "idle",
    size: 30,
  });
  try {
    // Nothing is invented for an id this build has no art for.
    expect(ofKind(unknown.container, "Path")).toHaveLength(0);
    expect(ofKind(unknown.container, "Ellipse")).toHaveLength(0);
    expect(ofKind(unknown.container, "Rect")).toHaveLength(3);
  } finally {
    await unknown.cleanup();
  }
});

it("floats a halo above the head in its own color", async () => {
  const face = await renderFace({
    avatar: { ...home, accessories: [{ kind: "halo", color: "#ffd166" }] },
    state: "idle",
    size: 30,
  });
  try {
    const rings = ofKind(face.container, "Ellipse");
    expect(rings).toHaveLength(2);
    expect(propsOf(rings[1]!)).toMatchObject({
      stroke: "#ffd166",
      strokeWidth: 8,
      rx: 56,
      ry: 14,
    });
    expect(propsOf(rings[0]!).opacity).toBe(0.16);
    expect(String(propsOf(ofKind(face.container, "G")[0]!).transform)).toContain("scale(0.");
  } finally {
    await face.cleanup();
  }
});

it("keeps a Tot shape under its accessories", async () => {
  const face = await renderFace({
    avatar: { ...home, shape: "flower", accessories: [{ kind: "glasses" }] },
    state: "idle",
    size: 30,
  });
  try {
    const head = ofKind(face.container, "Path")[0]!;
    expect(propsOf(head).fill).toBe("#0A7EA4");
    expect(String(propsOf(head).d).startsWith("M")).toBe(true);
    expect(ofKind(face.container, "Ellipse")).toHaveLength(0);
    expect(
      ofKind(face.container, "Rect").filter((rect) => propsOf(rect).stroke === "#262b33"),
    ).toHaveLength(2);
  } finally {
    await face.cleanup();
  }
});
