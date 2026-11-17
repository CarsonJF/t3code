import type { EnvironmentTot } from "@t3tools/client-runtime/tots";
import { DEFAULT_HOME_TOT, EnvironmentId, type Tot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { moveTotOrder, orderTots, totOrderKey, withVisibleTotKeys } from "./totsSidebarOrder";

const entry = (environmentId: string, id: string): EnvironmentTot => ({
  environmentId: EnvironmentId.make(environmentId),
  tot: { ...DEFAULT_HOME_TOT, id: id as Tot["id"], name: id },
});

describe("totOrderKey", () => {
  it("scopes a row to its host machine", () => {
    expect(totOrderKey(entry("machine-a", "home"))).toBe("machine-a:home");
    expect(totOrderKey(entry("machine-b", "home"))).toBe("machine-b:home");
  });
});

describe("orderTots", () => {
  it("keeps the incoming order when nothing is stored", () => {
    const entries = [entry("machine-a", "gamma"), entry("machine-a", "alpha")];

    expect(orderTots(entries, [])).toBe(entries);
  });

  it("orders named rows and leaves new rows after them", () => {
    const entries = [
      entry("machine-a", "alpha"),
      entry("machine-a", "beta"),
      entry("machine-a", "new"),
    ];

    expect(orderTots(entries, ["machine-a:beta", "machine-a:alpha"]).map(totOrderKey)).toEqual([
      "machine-a:beta",
      "machine-a:alpha",
      "machine-a:new",
    ]);
  });

  it("orders by machine-scoped keys, not ids", () => {
    const entries = [entry("machine-a", "home"), entry("machine-b", "home")];

    expect(orderTots(entries, ["machine-b:home", "machine-a:home"]).map(totOrderKey)).toEqual([
      "machine-b:home",
      "machine-a:home",
    ]);
  });
});

describe("withVisibleTotKeys", () => {
  it("keeps keys for rows that are away and appends rows it has not seen", () => {
    expect(
      withVisibleTotKeys(
        ["machine-a:alpha", "machine-b:beta"],
        ["machine-a:gamma", "machine-a:alpha"],
      ),
    ).toEqual(["machine-a:alpha", "machine-b:beta", "machine-a:gamma"]);
  });

  it("returns the same list when every visible row is already named", () => {
    const order = ["machine-a:alpha", "machine-b:beta"];

    expect(withVisibleTotKeys(order, ["machine-b:beta"])).toBe(order);
  });
});

describe("moveTotOrder", () => {
  const order = ["a", "b", "c", "d"];

  it("drops before and after a target in the same list", () => {
    expect(moveTotOrder(order, "a", "c", "before")).toEqual(["b", "a", "c", "d"]);
    expect(moveTotOrder(order, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
    expect(moveTotOrder(order, "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves the last row to the front", () => {
    expect(moveTotOrder(order, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
  });

  it("does nothing for a row dropped on itself or a missing target", () => {
    expect(moveTotOrder(order, "a", "a", "after")).toBe(order);
    expect(moveTotOrder(order, "a", "missing", "after")).toBe(order);
  });
});
