import { TotId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  applyThemeCss,
  applyTotThemeCss,
  scopeSelector,
  scopeSelectorToTot,
  splitSelectors,
} from "./totThemeCss";

const yui = TotId.make("yui");

const conversationWith = (markup: string) => {
  const conversation = document.createElement("div");
  conversation.dataset.totId = yui;
  conversation.setAttribute("data-workspace-area", "conversation");
  conversation.innerHTML = markup;
  const sidebar = document.createElement("div");
  sidebar.dataset.slot = "sidebar";
  sidebar.innerHTML = markup;
  document.body.append(conversation, sidebar);
  return {
    conversation,
    sidebar,
    [Symbol.dispose]: () => {
      conversation.remove();
      sidebar.remove();
    },
  };
};

it("scopes one selector to the Tot conversation, keeping appearance context", () => {
  expect(scopeSelectorToTot(".messages-timeline-scroll", yui)).toBe(
    '[data-tot-id="yui"] .messages-timeline-scroll',
  );
  expect(scopeSelectorToTot(":root", yui)).toBe('[data-tot-id="yui"]');
  expect(scopeSelectorToTot("html body .row", yui)).toBe('[data-tot-id="yui"] .row');
  expect(scopeSelectorToTot("body > .row", yui)).toBe('[data-tot-id="yui"] > .row');
  expect(scopeSelectorToTot(":root.dark .row", yui)).toBe(':root.dark [data-tot-id="yui"] .row');
  expect(scopeSelectorToTot(":root:not(.dark) .row", yui)).toBe(
    ':root:not(.dark) [data-tot-id="yui"] .row',
  );
  // An author's own scoping is already the hook, so it is not doubled.
  expect(scopeSelectorToTot('[data-tot-id="yui"] .row', yui)).toBe('[data-tot-id="yui"] .row');
  expect(scopeSelectorToTot("[data-tot-id] .row", yui)).toBe("[data-tot-id] .row");
});

it("scopes a companion's CSS to its view and reads a Tot theme's root as that view", () => {
  const companion = { kind: "companion", id: "yui" } as const;
  expect(scopeSelector(".chat-markdown a", companion)).toBe(
    '[data-companion-id="yui"] .chat-markdown a',
  );
  expect(scopeSelector(":root", companion)).toBe('[data-companion-id="yui"]');
  expect(scopeSelector(":root.dark .row", companion)).toBe(
    ':root.dark [data-companion-id="yui"] .row',
  );
  // Yui's Tot theme export, unchanged.
  expect(scopeSelector('[data-tot-id="yui"][data-thread-id]', companion)).toBe(
    '[data-companion-id="yui"]',
  );
  expect(
    scopeSelector('[data-tot-id="yui"][data-thread-id]>iframe[title="Theme effect"]', companion),
  ).toBe('[data-companion-id="yui"]>iframe[title="Theme effect"]');
  expect(scopeSelector('[data-tot-id="yui"] ::selection', companion)).toBe(
    '[data-companion-id="yui"] ::selection',
  );
  expect(
    scopeSelector('[data-companion-id="yui"][data-companion-channel="child:chef"] .x', companion),
  ).toBe('[data-companion-id="yui"][data-companion-channel="child:chef"] .x');
  // The Tot root mapping is only for companions: a Tot keeps its own rules.
  expect(scopeSelectorToTot('[data-companion-id="yui"] .x', yui)).toBe(
    '[data-tot-id="yui"] [data-companion-id="yui"] .x',
  );
});

it("styles only the companion's view, not a Tot's or the sidebar", () => {
  const view = document.createElement("div");
  view.dataset.companionId = "yui";
  view.innerHTML = '<p class="probe">Hi</p>';
  const tot = document.createElement("div");
  tot.dataset.totId = "yui";
  tot.innerHTML = '<p class="probe">Hi</p>';
  document.body.append(view, tot);
  using _dom = { [Symbol.dispose]: () => (view.remove(), tot.remove()) };
  using _sheet = {
    [Symbol.dispose]: applyThemeCss(
      { kind: "companion", id: "yui" },
      '[data-tot-id="yui"] .probe { color: rgb(1, 2, 3); background: url(https://example.com/a.png); }',
    ),
  };
  const probe = view.querySelector(".probe")!;
  expect(getComputedStyle(probe).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(probe).backgroundImage).toBe("none");
  expect(getComputedStyle(tot.querySelector(".probe")!).color).not.toBe("rgb(1, 2, 3)");
});

it("splits a selector list without breaking :is()", () => {
  expect(splitSelectors(":is(.a, .b) .c, .d")).toEqual([":is(.a, .b) .c", ".d"]);
});

it("styles only the Tot's conversation, until it is removed", () => {
  using dom = conversationWith('<p class="probe">Hi</p>');
  const probe = dom.conversation.querySelector(".probe")!;
  const sidebarProbe = dom.sidebar.querySelector(".probe")!;

  const remove = applyTotThemeCss(
    yui,
    `
      .probe { color: rgb(1, 2, 3); }
      :root { background-color: rgb(4, 5, 6); }
      @keyframes pulse { from { opacity: 0.2; } to { opacity: 1; } }
    `,
  );
  using _sheet = { [Symbol.dispose]: remove };

  expect(getComputedStyle(probe).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(sidebarProbe).color).not.toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(dom.conversation).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(document.body).backgroundColor).not.toBe("rgb(4, 5, 6)");
  // @keyframes keep their global names, so animations still resolve.
  expect(
    document.adoptedStyleSheets.flatMap((sheet) =>
      Array.from(sheet.cssRules, (rule) => rule.cssText),
    ),
  ).toContainEqual(expect.stringContaining("@keyframes pulse"));

  remove();
  expect(getComputedStyle(probe).color).not.toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(dom.conversation).backgroundColor).not.toBe("rgb(4, 5, 6)");
});

it("drops what would load a remote file, like themes do", () => {
  using dom = conversationWith('<p class="probe">Hi</p>');
  const probe = dom.conversation.querySelector(".probe")!;

  using _sheet = {
    [Symbol.dispose]: applyTotThemeCss(
      yui,
      `
        @import url(https://example.com/sheet.css);
        .probe {
          color: rgb(7, 8, 9);
          background-image: url(https://example.com/a.png);
          list-style-image: u\\72l(https://example.com/b.png);
        }
      `,
    ),
  };

  expect(getComputedStyle(probe).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(probe).backgroundImage).toBe("none");
  expect(getComputedStyle(probe).listStyleImage).toBe("none");
  expect(
    document.adoptedStyleSheets
      .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
      .join("\n"),
  ).not.toContain("example.com");
});
