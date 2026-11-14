import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { TotAvatar } from "./TotAvatar";

const avatar = { color: "#0A7EA4" };

describe("TotAvatar", () => {
  it("moves only while hovered in the sidebar, and holds still when animation is off", async () => {
    await using screen = await render(
      <TotAvatar avatar={avatar} state="working" animation="hover" size={20} hovered={false} />,
      { router: false /* a lone avatar, no routes */ },
    );
    const face = () => screen.container.querySelector("boop-face");
    await expect.element(face()).toHaveAttribute("motion", "reduce");

    await screen.rerender(
      <TotAvatar avatar={avatar} state="working" animation="hover" size={20} hovered />,
    );
    await expect.element(face()).toHaveAttribute("motion", "auto");

    await screen.rerender(
      <TotAvatar avatar={avatar} state="working" animation="still" size={20} hovered />,
    );
    await expect.element(face()).toHaveAttribute("motion", "reduce");
  });

  it("animates fully in the Tot's own view", async () => {
    await using screen = await render(
      <TotAvatar avatar={avatar} state="needs-you" animation="full" size={28} />,
      { router: false /* a lone avatar, no routes */ },
    );
    const face = screen.container.querySelector("boop-face");
    await expect.element(face).toHaveAttribute("motion", "auto");
    await expect.element(face).toHaveAttribute("data-tot-state", "needs-you");
  });
});
