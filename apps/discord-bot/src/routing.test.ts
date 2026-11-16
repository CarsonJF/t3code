import { describe, expect, it } from "vite-plus/test";

import {
  type RouteContext,
  type TotView,
  autocompleteTots,
  createStickyTots,
  findTotByName,
  resolveTot,
  routeCommand,
  routeText,
  routeToTot,
} from "./routing.ts";

const tot = (id: string, name: string, threadId: string | null = `thread-${id}`): TotView => ({
  id,
  name,
  enabled: threadId !== null,
  threadId,
  link: threadId === null ? null : `https://app.t3.codes/threads/env/${threadId}`,
});

const tots = [
  tot("tot-home", "Home"),
  tot("tot-squirt", "Squirt"),
  tot("tot-build", "Build"),
  tot("tot-builder", "Builder"),
];

const context = (userId = "user-1"): RouteContext => ({
  tots,
  sticky: createStickyTots(),
  defaultName: "Home",
  userId,
});

describe("resolveTot", () => {
  it("defaults to Home when nothing is picked", () => {
    const resolution = resolveTot(context());

    expect(resolution.kind === "tot" ? resolution.tot.name : null).toBe("Home");
  });

  it("keeps a per-user sticky Tot", () => {
    const base = context();
    base.sticky.set("user-1", "tot-squirt");

    const mine = resolveTot(base);
    const other = resolveTot({ ...base, userId: "user-2" });

    expect(mine.kind === "tot" ? mine.tot.name : null).toBe("Squirt");
    expect(other.kind === "tot" ? other.tot.name : null).toBe("Home");
  });

  it("falls back to Home when the sticky Tot is gone", () => {
    const base = context();
    base.sticky.set("user-1", "tot-removed");

    const resolution = resolveTot(base);

    expect(resolution.kind === "tot" ? resolution.tot.name : null).toBe("Home");
  });

  it("says a Tot with no thread is not running", () => {
    const off: RouteContext = { ...context(), tots: [tot("tot-home", "Home", null)] };

    expect(resolveTot(off)).toEqual({
      kind: "unavailable",
      tot: tot("tot-home", "Home", null),
      message: expect.stringContaining("Home is not running"),
    });
  });

  it("names the Tots to pick from when Home is missing", () => {
    const noHome: RouteContext = { ...context(), tots: [tot("tot-squirt", "Squirt")] };

    expect(resolveTot(noHome)).toEqual({
      kind: "unavailable",
      message: expect.stringContaining("There is no Tot named Home"),
    });
  });

  it("says so when nothing is set up", () => {
    expect(resolveTot({ ...context(), tots: [] }).kind).toBe("unavailable");
  });
});

describe("routeText", () => {
  it("sends plain text to the sticky Tot", () => {
    const base = context();
    base.sticky.set("user-1", "tot-squirt");

    const decision = routeText(base, "what's up?");

    expect(decision).toMatchObject({
      kind: "send",
      text: "what's up?",
      fresh: false,
      tot: { name: "Squirt" },
    });
  });

  it("marks a send fresh only for the armed Tot", () => {
    const base = context();

    expect(routeText(base, "hi", { freshTotIds: new Set(["tot-home"]) })).toMatchObject({
      fresh: true,
    });
    expect(routeText(base, "hi", { freshTotIds: new Set(["tot-squirt"]) })).toMatchObject({
      fresh: false,
    });
  });

  it("rejects an empty message", () => {
    expect(routeText(context(), "   ").kind).toBe("unavailable");
  });
});

describe("routeCommand", () => {
  it("picks a Tot by unique prefix", () => {
    expect(routeCommand(context(), { kind: "use", name: "squ" })).toMatchObject({
      kind: "use",
      tot: { name: "Squirt" },
    });
  });

  it("picks a Tot by autocomplete id", () => {
    expect(routeCommand(context(), { kind: "use", name: "tot-builder" })).toMatchObject({
      kind: "use",
      tot: { name: "Builder" },
    });
  });

  it("prefers an exact name over other prefix matches", () => {
    expect(routeCommand(context(), { kind: "use", name: "build" })).toMatchObject({
      kind: "use",
      tot: { name: "Build" },
    });
  });

  it("refuses an ambiguous name", () => {
    expect(routeCommand(context(), { kind: "use", name: "buil" }).kind).toBe("unavailable");
  });

  it("lists the Tots a name could mean", () => {
    const decision = routeCommand(context(), { kind: "use", name: "nope" });

    expect(decision).toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("Home, Squirt, Build, Builder"),
    });
  });

  it("arms a fresh session for the sticky Tot", () => {
    const base = context();
    base.sticky.set("user-1", "tot-squirt");

    expect(routeCommand(base, { kind: "new" })).toMatchObject({
      kind: "new",
      tot: { name: "Squirt" },
    });
  });

  it("stops the sticky Tot", () => {
    expect(routeCommand(context(), { kind: "stop" })).toMatchObject({
      kind: "stop",
      tot: { name: "Home" },
    });
  });
});

describe("findTotByName", () => {
  it("prefers an exact name over a prefix", () => {
    expect(findTotByName(tots, "build")?.name).toBe("Build");
  });

  it("matches case-insensitively", () => {
    expect(findTotByName(tots, "HOME")?.name).toBe("Home");
  });

  it("returns nothing for an empty query", () => {
    expect(findTotByName(tots, "  ")).toBeUndefined();
  });
});

describe("autocompleteTots", () => {
  it("puts prefix matches first, then the rest", () => {
    expect(autocompleteTots(tots, "build").map((entry) => entry.name)).toEqual([
      "Build",
      "Builder",
    ]);
  });

  it("matches a substring anywhere", () => {
    expect(autocompleteTots(tots, "ir").map((entry) => entry.name)).toEqual(["Squirt"]);
  });

  it("returns everything for an empty query, alphabetically", () => {
    expect(autocompleteTots(tots, "").map((entry) => entry.name)).toEqual([
      "Build",
      "Builder",
      "Home",
      "Squirt",
    ]);
  });

  it("caps the list", () => {
    expect(autocompleteTots(tots, "", 2)).toHaveLength(2);
  });
});

describe("routeToTot", () => {
  it("picks the channel's Tot even when another one is sticky", () => {
    const decision = routeToTot(tots, "tot-home", "Hi Home");

    expect(decision).toMatchObject({ kind: "send", text: "Hi Home" });
    expect(decision.kind === "send" ? decision.tot.id : null).toBe("tot-home");
  });

  it("names a Tot that is not on the server", () => {
    expect(routeToTot(tots, "tot-gone", "Hi")).toEqual({
      kind: "unavailable",
      message: "There is no Tot tot-gone on this T3 server.",
    });
  });

  it("says a Tot with no thread is not running", () => {
    expect(routeToTot([tot("tot-home", "Home", null)], "tot-home", "Hi")).toEqual({
      kind: "unavailable",
      tot: tot("tot-home", "Home", null),
      message: expect.stringContaining("Home is not running"),
    });
  });

  it("carries the channel's fresh session", () => {
    const decision = routeToTot(tots, "tot-home", "Hi", {
      freshTotIds: new Set(["tot-home"]),
    });

    expect(decision).toMatchObject({ kind: "send", fresh: true });
  });

  it("refuses empty text", () => {
    expect(routeToTot(tots, "tot-home", "   ")).toMatchObject({
      kind: "unavailable",
      message: "That message was empty.",
    });
  });
});
