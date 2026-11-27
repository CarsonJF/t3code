import type { ExternalCompanionConfig } from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { CompanionThemeDialog } from "./ExternalCompanionsSettings";

const config: ExternalCompanionConfig = {
  id: "yui",
  label: "Yui",
  baseUrl: "http://127.0.0.1:4790",
  token: "",
};

// The dialog's footer can sit under Base UI's inert layer in the small test viewport.
const press = (name: string) =>
  page
    .getByRole("button", { name })
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("CompanionThemeDialog", () => {
  it("saves CSS and an effect, showing the companion's scope", async () => {
    const onSave = vi.fn(async () => {});
    await using _screen = await render(
      <CompanionThemeDialog
        config={config}
        name="Yui"
        canWrite
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    await expect.element(page.getByText('[data-companion-id="yui"]')).toBeVisible();
    await userEvent.fill(
      page.getByLabelText("Companion theme CSS"),
      ".chat-markdown { color: red }",
    );
    await userEvent.fill(page.getByLabelText("Companion theme effect"), "fx.canvas");
    press("Save");
    expect(onSave).toHaveBeenCalledWith({
      css: ".chat-markdown { color: red }",
      effect: "fx.canvas",
    });
  });

  it("refuses CSS that loads a file, as the Tot editor does", async () => {
    const onSave = vi.fn(async () => {});
    await using _screen = await render(
      <CompanionThemeDialog
        config={config}
        name="Yui"
        canWrite
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    await userEvent.fill(
      page.getByLabelText("Companion theme CSS"),
      ".x { background: url(https://example.com/a.png) }",
    );
    await expect.element(page.getByText(/theme\.css cannot load files/)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("clears a saved theme", async () => {
    const onSave = vi.fn(async () => {});
    await using _screen = await render(
      <CompanionThemeDialog
        config={{ ...config, theme: { css: ".x { color: red }" } }}
        name="Yui"
        canWrite
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    press("Clear theme");
    expect(onSave).toHaveBeenCalledWith(undefined);
  });
});
