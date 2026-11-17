import { TOT_SKIN_SERIES } from "@t3tools/client-runtime/tots/skins";
import type { TotAvatar } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
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
