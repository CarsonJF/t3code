import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { TotAvatar } from "./TotAvatar";

const avatar = { color: "#0A7EA4" };

describe("TotAvatar accessories", () => {
  const face = (container: HTMLElement) => container.querySelector("boop-face") as HTMLElement;
  const accessory = (container: HTMLElement, kind: string) =>
    face(container).shadowRoot?.querySelector(`[data-accessory="${kind}"]`) ?? null;

  it("wears the accessories on its face, above the eyes", async () => {
    await using screen = await render(
      <TotAvatar
        avatar={{ ...avatar, accessories: [{ kind: "glasses" }] }}
        state="idle"
        animation="still"
        size={64}
      />,
      { router: false /* a lone avatar, no routes */ },
    );

    await vi.waitFor(() => expect(accessory(screen.container, "glasses")).not.toBeNull());
    const glasses = accessory(screen.container, "glasses")!;
    // The layer sits inside the moving head, so it follows every pose.
    expect(glasses.closest("#headMotion")).not.toBeNull();
    expect(glasses.getAttribute("data-anchor")).toBe("eyes");
    expect(glasses.querySelectorAll("rect")).toHaveLength(2);

    await screen.rerender(<TotAvatar avatar={avatar} state="idle" animation="still" size={64} />);
    await vi.waitFor(() =>
      expect(face(screen.container).shadowRoot?.querySelector("[data-accessory]")).toBeNull(),
    );
  });

  it("keeps the antenna and the Tot shape working under a hat", async () => {
    await using screen = await render(
      <TotAvatar
        avatar={{ ...avatar, shape: "flower", accessories: [{ kind: "top-hat" }] }}
        state="idle"
        animation="still"
        size={64}
      />,
      { router: false /* a lone avatar, no routes */ },
    );

    const root = () => face(screen.container).shadowRoot!;
    await vi.waitFor(() => expect(accessory(screen.container, "top-hat")).not.toBeNull());
    const shaped = root().querySelector("#headShape")!.getAttribute("d");
    expect(accessory(screen.container, "top-hat")!.getAttribute("data-anchor")).toBe("head-top");
    // The antenna stays hidden, and the hat layer never stands in for the outline.
    expect(root().getElementById("tot-antenna-style")).not.toBeNull();

    await screen.rerender(
      <TotAvatar
        avatar={{ ...avatar, shape: "round", accessories: [{ kind: "top-hat" }] }}
        state="idle"
        animation="still"
        size={64}
      />,
    );
    await vi.waitFor(() =>
      expect(root().querySelector("#headShape")!.getAttribute("d")).not.toBe(shaped),
    );

    await screen.rerender(
      <TotAvatar
        avatar={{ ...avatar, shape: "round", antenna: true, accessories: [{ kind: "top-hat" }] }}
        state="idle"
        animation="still"
        size={64}
      />,
    );
    await vi.waitFor(() => expect(root().getElementById("tot-antenna-style")).toBeNull());
    expect(accessory(screen.container, "top-hat")).not.toBeNull();
  });
});

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
