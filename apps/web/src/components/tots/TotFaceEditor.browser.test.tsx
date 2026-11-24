import { TOT_SKIN_SERIES } from "@t3tools/client-runtime/tots/skins";
import type { TotAvatar } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
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
    // The switch draws no width without the app's theme variables, so click it directly.
    (screen.getByRole("switch", { name: "Fluffy" }).element() as HTMLElement).click();
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      shape: "flower",
      style: "open-bot",
      openBot: { figure: "mug", material: "fluffy" },
    });

    await userEvent.click(screen.getByRole("button", { name: "BoopFace" }));
    expect(onChange).toHaveBeenLastCalledWith({
      color: "#0A7EA4",
      shape: "flower",
      openBot: { figure: "mug", material: "fluffy" },
    });
    await expect.element(screen.getByRole("button", { name: "Shape flower" })).toBeVisible();
  });
});
