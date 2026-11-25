import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "../../index.css";
import { render } from "../../../test/render";
import { getClientSettings } from "../../hooks/useSettings";
import { TouchBarSettings } from "./TouchBarSettings";

it("previews sample limits and redraws the strip as settings change", async () => {
  await using screen = await render(<TouchBarSettings />);
  const preview = page.getByRole("img", { name: "Touch Bar preview" });
  await expect.poll(() => preview.element().textContent).toContain("Claude Code");
  await expect.poll(() => preview.element().textContent).toContain("Weekly · Fable");
  await expect.poll(() => preview.element().textContent).toContain("42% 3h");

  await screen.getByRole("switch", { name: "Compact Touch Bar" }).click();
  await expect.poll(() => preview.element().textContent).toContain("Session 42% 3h");
  expect(getClientSettings().touchBar.compact).toBe(true);

  await screen.getByRole("switch", { name: "Show Claude Code on the Touch Bar" }).click();
  await expect.poll(() => preview.element().textContent).toMatch(/^Cursor/);
  expect(getClientSettings().touchBar.providers).toEqual([
    { driver: "claudeAgent", enabled: false },
    { driver: "cursor", enabled: true },
  ]);

  await screen.getByRole("switch", { name: "Show usage limits on the Touch Bar" }).click();
  await expect.poll(() => preview.element().textContent).toContain("The Touch Bar strip is off.");
});
