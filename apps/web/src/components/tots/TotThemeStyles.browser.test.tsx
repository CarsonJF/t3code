import { TotId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import type { ReactNode } from "react";

import { render } from "../../../test/render";
import { ThemeSheet, TotThemeSheet } from "./TotThemeStyles";

const yui = TotId.make("yui");

const probes = (
  <div data-tot-id="yui" data-workspace-area="conversation">
    <p>Tot text</p>
  </div>
);

const scenario = (sheet: ReactNode) => (
  <>
    {probes}
    <div data-slot="sidebar">
      <p>Sidebar text</p>
    </div>
    {sheet}
  </>
);

it("mounts the open Tot's sheet and follows live edits, then removes it", async () => {
  // TotThemeSheet takes no router hooks.
  await using screen = await render(
    scenario(
      <TotThemeSheet totId={yui} theme={{ css: ":root { background-color: rgb(1, 2, 3); }" }} />,
    ),
    { router: false },
  );
  const conversation = screen.container.querySelector<HTMLElement>('[data-tot-id="yui"]')!;
  const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
  const sheetHas = (text: string) =>
    document.adoptedStyleSheets.some((sheet) =>
      Array.from(sheet.cssRules, (rule) => rule.cssText)
        .join("\n")
        .includes(text),
    );

  expect(getComputedStyle(conversation).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(sidebar).backgroundColor).not.toBe("rgb(1, 2, 3)");
  expect(sheetHas('[data-tot-id="yui"]')).toBe(true);

  await screen.rerender(
    scenario(
      <TotThemeSheet totId={yui} theme={{ css: ":root { background-color: rgb(4, 5, 6); }" }} />,
    ),
  );
  expect(getComputedStyle(conversation).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(sheetHas("rgb(1, 2, 3)")).toBe(false);

  // Navigating to another thread renders the component without a Tot theme.
  await screen.rerender(scenario(<TotThemeSheet totId={yui} theme={{ css: "" }} />));
  expect(getComputedStyle(conversation).backgroundColor).not.toBe("rgb(4, 5, 6)");
  expect(sheetHas('[data-tot-id="yui"]')).toBe(false);

  await screen.rerender(
    scenario(
      <TotThemeSheet totId={yui} theme={{ css: ":root { background-color: rgb(7, 8, 9); }" }} />,
    ),
  );
  expect(getComputedStyle(conversation).backgroundColor).toBe("rgb(7, 8, 9)");
  await screen.unmount();
  expect(getComputedStyle(conversation).backgroundColor).not.toBe("rgb(7, 8, 9)");
});

it("never mounts a sheet for a non-Tot thread", async () => {
  await using screen = await render(
    scenario(
      <TotThemeSheet totId={null} theme={{ css: ":root { background-color: rgb(1, 2, 3); }" }} />,
    ),
    { router: false },
  );
  const conversation = screen.container.querySelector<HTMLElement>('[data-tot-id="yui"]')!;

  expect(getComputedStyle(conversation).backgroundColor).not.toBe("rgb(1, 2, 3)");
  expect(
    document.adoptedStyleSheets.some((sheet) =>
      Array.from(sheet.cssRules, (rule) => rule.cssText)
        .join("\n")
        .includes('data-tot-id="yui"'),
    ),
  ).toBe(false);
});

it("mounts a companion's sheet on its view only, reading a Tot theme's root as the view", async () => {
  await using screen = await render(
    <>
      <div data-companion-id="yui" data-companion-channel="main">
        <p>Companion text</p>
      </div>
      {probes}
      <ThemeSheet
        kind="companion"
        scopeId="yui"
        css={'[data-tot-id="yui"][data-thread-id] { background-color: rgb(1, 2, 3); }'}
      />
    </>,
    { router: false },
  );
  const view = screen.container.querySelector<HTMLElement>('[data-companion-id="yui"]')!;
  const tot = screen.container.querySelector<HTMLElement>('[data-tot-id="yui"]')!;
  expect(getComputedStyle(view).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(tot).backgroundColor).not.toBe("rgb(1, 2, 3)");
  await screen.unmount();
  expect(getComputedStyle(view).backgroundColor).not.toBe("rgb(1, 2, 3)");
});
