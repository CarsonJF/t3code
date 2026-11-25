import { TOT_SKIN_SERIES } from "@t3tools/client-runtime/tots/skins";
import type { TotAvatar } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { EnvironmentId } from "@t3tools/contracts";

import { setAvatarLibrary } from "./avatarLibraryStore";
import { loadOpenBot } from "./OpenBotFace";
import { TotFaceEditor } from "./TotFaceEditor";

function Harness(props: {
  readonly initial: TotAvatar;
  readonly onChange: (value: TotAvatar) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <TotFaceEditor
      value={value}
      onChange={(next) => {
        props.onChange(next);
        setValue(next);
      }}
      skinSeries={TOT_SKIN_SERIES[0]!}
      onSkinSeriesChange={() => {}}
    />
  );
}

describe("TotFaceEditor accessories", () => {
  it("wears the catalog id, shows its color, and clears it again", async () => {
    const onChange = vi.fn();
    await using screen = await render(
      <Harness initial={{ color: "#0A7EA4" }} onChange={onChange} />,
      {
        router: false /* the editor is a lone form, no routes */,
      },
    );

    const chip = () => screen.getByRole("button", { name: "Wear Top hat" });
    await userEvent.click(chip());
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      accessories: [{ kind: "cardinal.top-hat" }],
    });

    const swatch = screen.container.querySelector<HTMLInputElement>(
      'input[type="color"][aria-label="Top hat color"]',
    );
    expect(swatch?.value).toBe("#191b20");

    await userEvent.click(screen.getByRole("button", { name: "Remove Top hat" }));
    expect(onChange).toHaveBeenLastCalledWith({ color: "#0A7EA4" });
  });
});

describe("TotFaceEditor styles", () => {
  it("switches to open-bot with its controls, and back without losing either look", async () => {
    await loadOpenBot();
    const onChange = vi.fn();
    await using screen = await render(
      <Harness initial={{ color: "#0A7EA4", shape: "flower" }} onChange={onChange} />,
      { router: false /* the editor is a lone form, no routes */ },
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Bot" }));
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      shape: "flower",
      style: "open-bot",
      openBot: { figure: "chat" },
    });
    await expect
      .element(screen.getByRole("button", { name: "Shape flower" }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Figure Mug" }));
    await userEvent.click(screen.getByRole("button", { name: "Glass" }));
    await userEvent.click(screen.getByRole("button", { name: "Light eyes" }));
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      shape: "flower",
      style: "open-bot",
      openBot: { figure: "mug", material: "glass", eyeColor: "#f8fafc" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      shape: "flower",
      style: "open-bot",
      openBot: { figure: "mug", eyeColor: "#f8fafc" },
    });

    await userEvent.click(screen.getByRole("button", { name: "BoopFace" }));
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      shape: "flower",
      openBot: { figure: "mug", eyeColor: "#f8fafc" },
    });
    await expect.element(screen.getByRole("button", { name: "Shape flower" })).toBeVisible();
  });
});

describe("TotFaceEditor library", () => {
  it("lists library figures and themes next to the built-in ones, marked custom", async () => {
    await loadOpenBot();
    const beacon = {
      id: "beacon",
      name: "Beacon",
      avatar: {
        color: "#EA580C",
        style: "open-bot",
        openBot: { figure: "lighthouse", mood: "happy" },
      },
    } as const;
    setAvatarLibrary(EnvironmentId.make("environment:editor-library"), {
      figures: [
        {
          version: 1,
          id: "lighthouse",
          name: "Lighthouse",
          body: { path: "M38 30 L62 30 L68 88 L32 88 Z M42 14 L58 14 L60 30 L40 30 Z" },
          eyes: { x: 50, y: 56, spacing: 14, scale: 1 },
        },
      ],
      themes: [beacon],
    });
    const onChange = vi.fn();
    await using screen = await render(
      <Harness
        initial={{ color: "#0A7EA4", style: "open-bot", openBot: { figure: "chat" } }}
        onChange={onChange}
      />,
      { router: false /* the editor is a lone form, no routes */ },
    );

    await expect
      .element(screen.getByRole("button", { name: "Figure Lighthouse (custom)" }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Figure Mug" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Face theme Classic" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Face theme Beacon (custom)" }));
    expect(onChange).toHaveBeenLastCalledWith(beacon.avatar);
  });
});
