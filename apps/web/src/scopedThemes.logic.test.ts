import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SCOPED_THEMES,
  resolveScopedThemeId,
  scopedThemeKey,
  withScopedTheme,
} from "./scopedThemes.logic";

describe("scoped themes", () => {
  const scoped = {
    tots: { "env:yui": "grove" },
    projects: { "env:p1": "ocean" },
    groups: { "env:g1": "ember" },
  };

  it("takes the Tot's theme, then the project's, then the group's", () => {
    const all = { tot: "env:yui", project: "env:p1", group: "env:g1" };
    expect(resolveScopedThemeId(scoped, all)).toBe("grove");
    expect(resolveScopedThemeId(scoped, { ...all, tot: null })).toBe("ocean");
    expect(resolveScopedThemeId(scoped, { ...all, tot: null, project: "env:other" })).toBe("ember");
    expect(resolveScopedThemeId(scoped, { project: "env:other", group: "env:none" })).toBeNull();
  });

  it("sets and clears one assignment without touching the rest", () => {
    const set = withScopedTheme(
      EMPTY_SCOPED_THEMES,
      "projects",
      scopedThemeKey("env", "p1"),
      "iris",
    );
    expect(set.projects).toEqual({ "env:p1": "iris" });
    expect(withScopedTheme(set, "projects", "env:p1", null)).toEqual(EMPTY_SCOPED_THEMES);
    expect(withScopedTheme(scoped, "groups", "env:g1", null).projects).toBe(scoped.projects);
  });
});
