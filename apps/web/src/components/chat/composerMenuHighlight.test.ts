import { describe, expect, it } from "vite-plus/test";

import {
  nextComposerMenuHighlightId,
  resolveComposerMenuActiveItemId,
} from "./composerMenuHighlight";

describe("resolveComposerMenuActiveItemId", () => {
  it("clears the active result while async results are empty and resolves against restored results", () => {
    const search = {
      highlightedItemId: "second",
      currentSearchKey: "path:src",
      highlightedSearchKey: "path:src",
    };
    const cleared = resolveComposerMenuActiveItemId({ ...search, items: [] });
    expect(cleared).toBeNull();
    expect(
      resolveComposerMenuActiveItemId({
        ...search,
        highlightedItemId: cleared,
        items: [{ id: "new-result" }, { id: "second" }],
      }),
    ).toBe("new-result");
  });
});

describe("nextComposerMenuHighlightId", () => {
  const items = [{ id: "tot" }, { id: "environment" }, { id: "thread" }];

  it("walks Tots, machines and threads in menu order and wraps both ways", () => {
    expect(nextComposerMenuHighlightId({ items, highlightedItemId: "tot", key: "ArrowDown" })).toBe(
      "environment",
    );
    expect(
      nextComposerMenuHighlightId({ items, highlightedItemId: "environment", key: "ArrowDown" }),
    ).toBe("thread");
    expect(
      nextComposerMenuHighlightId({ items, highlightedItemId: "thread", key: "ArrowDown" }),
    ).toBe("tot");
    expect(nextComposerMenuHighlightId({ items, highlightedItemId: "tot", key: "ArrowUp" })).toBe(
      "thread",
    );
  });

  it("starts at the first item when nothing is highlighted, or at the last going up", () => {
    expect(nextComposerMenuHighlightId({ items, highlightedItemId: null, key: "ArrowDown" })).toBe(
      "tot",
    );
    expect(nextComposerMenuHighlightId({ items, highlightedItemId: null, key: "ArrowUp" })).toBe(
      "thread",
    );
    expect(
      nextComposerMenuHighlightId({ items, highlightedItemId: "removed", key: "ArrowDown" }),
    ).toBe("tot");
  });

  it("returns null when the picker has no results", () => {
    expect(
      nextComposerMenuHighlightId({ items: [], highlightedItemId: null, key: "ArrowDown" }),
    ).toBe(null);
  });
});
