import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ServerSettings, ServerSettingsPatch, ClientSettingsSchema } from "./settings.ts";
import {
  DEFAULT_HOME_TOT,
  isQuietTotThread,
  parseTotLaunchedThreadId,
  parseTotThreadId,
  TOT_FACE_ACTION,
  TotId,
  totLaunchedThreadId,
  totSlug,
  totThreadId,
  type Tot,
} from "./tots.ts";

const yui = TotId.make("yui");
const decodeServerSettings = Schema.decodeSync(ServerSettings);
const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);

describe("totSlug", () => {
  it("turns a name into a stable id", () => {
    expect(totSlug("Cardinal Systems")).toBe("cardinal-systems");
    expect(totSlug("  Work! ")).toBe("work");
    expect(totSlug("!!!")).toBeNull();
    expect(totSlug("a".repeat(40))?.length).toBe(32);
  });
});

describe("Tot thread ids", () => {
  it("round-trips a Tot's own thread id", () => {
    expect(parseTotThreadId(totThreadId(yui, "x1"))).toBe("yui");
    expect(parseTotThreadId("tot-launched:yui:c1")).toBeNull();
    expect(parseTotThreadId("thread:abc")).toBeNull();
  });

  it("round-trips a thread a Tot launched", () => {
    expect(parseTotLaunchedThreadId(totLaunchedThreadId(yui, "c1"))).toBe("yui");
    expect(parseTotLaunchedThreadId(totThreadId(yui, "x1"))).toBeNull();
  });
});

describe("TOT_FACE_ACTION", () => {
  it("maps every Tot state to its BoopFace action", () => {
    expect(TOT_FACE_ACTION).toEqual({
      idle: "idle",
      working: "waiting-spin",
      "needs-you": "wary",
      success: "success",
      failure: "failure",
      sleep: "sleep",
    });
  });
});

describe("Tot settings", () => {
  it("starts with Home and keeps Tots out of client settings patches", () => {
    expect(decodeServerSettings({}).tots).toEqual([DEFAULT_HOME_TOT]);
    expect("tots" in ServerSettingsPatch.fields).toBe(false);
  });

  it("animates Tot avatars by default on each client", () => {
    expect(decodeClientSettings({}).animateTotAvatars).toBe(true);
  });
});

describe("isQuietTotThread", () => {
  const tots = (enabled: boolean): ReadonlyArray<Tot> => [
    {
      ...DEFAULT_HOME_TOT,
      id: yui,
      name: "Yui",
      threadId: enabled ? totThreadId(yui, "n") : null,
    },
  ];

  it("quiets threads an enabled Tot launched", () => {
    expect(isQuietTotThread("tot-launched:yui:c", tots(true))).toBe(true);
    expect(isQuietTotThread("tot-launched:yui:c", tots(false))).toBe(false);
  });

  it("quiets any Tot-launched thread on a server that does not host Tots", () => {
    expect(isQuietTotThread("tot-launched:yui:c", null)).toBe(true);
    expect(isQuietTotThread("tot-launched:yui:c", [DEFAULT_HOME_TOT])).toBe(true);
    expect(isQuietTotThread("thread:x", null)).toBe(false);
  });
});
