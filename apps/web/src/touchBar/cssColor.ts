let probe: { readonly element: HTMLElement; readonly context: CanvasRenderingContext2D } | null =
  null;

/**
 * The sRGB hex of a CSS color, theme variables included, for native code that cannot read CSS.
 * The canvas converts any color space the theme uses (oklch, color-mix) to sRGB.
 */
export function cssColorToHex(color: string): string | null {
  if (probe === null) {
    const context = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) return null;
    const element = document.createElement("span");
    element.style.display = "none";
    document.body.append(element);
    probe = { element, context };
  }
  probe.element.style.color = "";
  probe.element.style.color = color;
  const resolved = getComputedStyle(probe.element).color;
  if (!resolved) return null;
  const { context } = probe;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000000";
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0) return null;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
