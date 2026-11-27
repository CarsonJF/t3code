import { describe, expect, it } from "vite-plus/test";

import { totCallerChoiceOf, totCallerEntryPatched, totCallerPick } from "./totWhoCanAsk.logic";

const known = [{ id: "yui", label: "Yui" }];

describe("totWhoCanAsk.logic", () => {
  it("shows * as anyone, a known id by name, and anything else as a typed id", () => {
    expect(totCallerChoiceOf({ id: "*" }, known)).toEqual({ kind: "anyone" });
    expect(totCallerChoiceOf({ id: "yui" }, known)).toEqual({ kind: "known", choice: known[0] });
    expect(totCallerChoiceOf({ id: "" }, known)).toEqual({ kind: "other" });
  });

  it("names a picked known caller and drops the old name when the caller changes", () => {
    const entry = { origin: "companion" as const, id: "yui", mode: "ask" as const, label: "Yui" };
    expect(totCallerEntryPatched(entry, totCallerPick("*", known))).toEqual({
      origin: "companion",
      id: "*",
      mode: "ask",
    });
    expect(totCallerEntryPatched({ ...entry, id: "*" }, totCallerPick("yui", known))).toEqual(
      entry,
    );
  });

  it("keeps a default entry a default while only its access changes", () => {
    const entry = {
      origin: "tot" as const,
      id: "*",
      mode: "full" as const,
      trustedByDefault: true as const,
    };
    expect(totCallerEntryPatched(entry, { mode: "ask" })).toEqual({ ...entry, mode: "ask" });
    expect(totCallerEntryPatched(entry, { id: "cardinal" })).toEqual({
      origin: "tot",
      id: "cardinal",
      mode: "full",
    });
  });
});
