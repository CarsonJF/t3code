import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { loadOpenBot } from "./OpenBotFace";
import { StillFigure } from "./StillFigure";

const figures = async (count: number) => (await loadOpenBot()).figures.slice(0, count);

describe("StillFigure", () => {
  it("draws flat as a plain image, with no live renderer", async () => {
    const [figure] = await figures(1);
    await using screen = await render(
      <StillFigure figure={figure!} color="#DB2777" finish="flat" size={88} />,
      { router: false /* a lone figure, no routes */ },
    );
    await expect
      .poll(() => screen.container.querySelector("img")?.getAttribute("src"))
      .toMatch(/^data:image\/svg\+xml/);
    expect(screen.container.querySelector("canvas")).toBeNull();
  });

  it("shows the flat silhouette first, then the painted finish as a cached image", async () => {
    const [figure] = await figures(1);
    await using screen = await render(
      <StillFigure figure={figure!} color="#16A34A" finish="glass" size={88} />,
      { router: false /* a lone figure, no routes */ },
    );
    const tile = () => screen.container.querySelector("[data-figure-finish]");
    expect(tile()?.querySelector("img")?.getAttribute("src") ?? "").toMatch(/^data:image\/svg|^$/);
    await expect
      .poll(() => tile()?.getAttribute("data-figure-finish"), { timeout: 10_000 })
      .toBe("glass");
    expect(tile()?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
    // The live renderer is gone once its image is cached.
    expect(screen.container.querySelector("canvas")).toBeNull();
  });

  it("paints one tile at a time and skips tiles that are not on screen", async () => {
    const list = await figures(4);
    await using screen = await render(
      <div>
        {list.map((figure) => (
          <StillFigure key={figure.id} figure={figure} color="#7C3AED" finish="fluffy" size={64} />
        ))}
        <div style={{ height: 4000 }} />
        <StillFigure figure={list[0]!} color="#EA580C" finish="fluffy" size={64} />
      </div>,
      { router: false /* lone figures, no routes */ },
    );
    let mostAtOnce = 0;
    const tiles = () => [...screen.container.querySelectorAll("[data-figure-finish]")];
    await expect
      .poll(
        () => {
          mostAtOnce = Math.max(mostAtOnce, screen.container.querySelectorAll("canvas").length);
          return tiles()
            .slice(0, 4)
            .every((tile) => tile.getAttribute("data-figure-finish") === "fluffy");
        },
        { timeout: 20_000, interval: 16 },
      )
      .toBe(true);
    expect(mostAtOnce).toBeLessThanOrEqual(1);
    const offscreen = tiles()[4]!;
    expect(offscreen.getAttribute("data-figure-finish")).toBe("flat");
    expect(offscreen.querySelector("img")).toBeNull();
  });
});
