import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

import { ServerSettings, ServerSettingsPatch, ClientSettingsSchema } from "./settings.ts";
import {
  DEFAULT_HOME_TOT,
  isQuietTotThread,
  isTotWorkerMessage,
  parseTotLaunchedThreadId,
  parseTotThreadId,
  TOT_FACE_ACTION,
  Tot,
  TotAvatar,
  TotId,
  totLaunchedThreadId,
  totSlug,
  totThreadId,
  totWatchReportsOf,
  type Tot as TotRecord,
} from "./tots.ts";

const yui = TotId.make("yui");
const decodeServerSettings = Schema.decodeSync(ServerSettings);
const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);
const decodeTot = Schema.decodeSync(Tot);

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
    expect(decodeClientSettings({}).totThemeEffects).toBe(true);
  });

  it("treats a Tot saved before watch reports as launched", () => {
    const saved = decodeTot({
      id: yui,
      name: "Yui",
      avatar: { color: "#0A7EA4" },
      scope: "all",
      instructions: "",
      projectId: null,
      threadId: null,
      modelSelection: null,
      watchAll: false,
      watches: [],
    });
    expect(saved.watchReports).toBeUndefined();
    expect(totWatchReportsOf(saved)).toBe("launched");
    expect(totWatchReportsOf({ watchReports: "explicit" })).toBe("explicit");
    expect(totWatchReportsOf({ watchReports: "off" })).toBe("off");
  });
});

describe("Tot accessories", () => {
  const decodeAvatar = Schema.decodeUnknownSync(TotAvatar);

  it("lets a face wear each accessory once, with its own color", () => {
    expect(
      decodeAvatar({
        color: "#0A7EA4",
        accessories: [
          { kind: "cardinal.top-hat" },
          { kind: "cardinal.glasses", color: "#262b33" },
          { kind: "cardinal.halo", color: "#F4C84B" },
        ],
      }),
    ).toEqual({
      color: "#0A7EA4",
      accessories: [
        { kind: "cardinal.top-hat" },
        { kind: "cardinal.glasses", color: "#262b33" },
        { kind: "cardinal.halo", color: "#F4C84B" },
      ],
    });
  });

  it("takes an id this build does not know, so a newer catalog needs no release", () => {
    const unknown = { kind: "cardinal.storm-cloud", color: "#94A3B8" };
    expect(decodeAvatar({ color: "#0A7EA4", accessories: [unknown] }).accessories).toEqual([
      unknown,
    ]);
  });

  it("still decodes the bare kinds older Tots saved", () => {
    expect(
      decodeAvatar({ color: "#0A7EA4", accessories: [{ kind: "top-hat" }, { kind: "glasses" }] })
        .accessories,
    ).toEqual([{ kind: "top-hat" }, { kind: "glasses" }]);
  });

  it("keeps accessories off a face that has none", () => {
    expect(decodeAvatar({ color: "#0A7EA4" })).toEqual({ color: "#0A7EA4" });
    expect(decodeAvatar({ color: "#0A7EA4", accessories: [] }).accessories).toEqual([]);
  });

  it("carries accessories through a Tot", () => {
    const saved = decodeTot({
      id: yui,
      name: "Yui",
      avatar: { color: "#0A7EA4", accessories: [{ kind: "cardinal.glasses" }] },
      scope: "all",
      instructions: "",
      projectId: null,
      threadId: null,
      modelSelection: null,
      watchAll: false,
      watches: [],
    });
    expect(saved.avatar.accessories).toEqual([{ kind: "cardinal.glasses" }]);
  });

  it("refuses a fourth accessory, a malformed id or a color that is not hex", () => {
    const four = ["top-hat", "glasses", "halo", "cardinal.crown"].map((kind) => ({ kind }));
    expect(() => decodeAvatar({ color: "#0A7EA4", accessories: four })).toThrow();
    for (const kind of [
      "Cardinal.Top-Hat",
      "cardinal..hat",
      "cardinal.top-hat-",
      "-cardinal",
      "",
    ]) {
      expect(() => decodeAvatar({ color: "#0A7EA4", accessories: [{ kind }] })).toThrow();
    }
    expect(() =>
      decodeAvatar({ color: "#0A7EA4", accessories: [{ kind: "cardinal.halo", color: "gold" }] }),
    ).toThrow();
  });
});

describe("isQuietTotThread", () => {
  const tots = (enabled: boolean): ReadonlyArray<TotRecord> => [
    {
      ...DEFAULT_HOME_TOT,
      id: yui,
      name: "Yui",
      projectId: ProjectId.make("project:yui"),
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
    expect(isQuietTotThread("tot-launched:home:c", [DEFAULT_HOME_TOT])).toBe(true);
    expect(isQuietTotThread("thread:x", null)).toBe(false);
  });
});

describe("isTotWorkerMessage", () => {
  const worker = totLaunchedThreadId(yui, "command-1");
  const yuiThread = totThreadId(yui, "current");
  const fromAgent = { createdBy: "agent", creationSource: "mcp" };

  it("is true for the launching Tot's message, here or over a link", () => {
    expect(isTotWorkerMessage(worker, { ...fromAgent, senderThreadId: yuiThread })).toBe(true);
    expect(
      isTotWorkerMessage(worker, { ...fromAgent, linkedSender: { threadId: yuiThread } }),
    ).toBe(true);
    expect(isTotWorkerMessage(worker, fromAgent)).toBe(true);
  });

  it("is false for people, the server, other Tots, and threads no Tot launched", () => {
    expect(
      isTotWorkerMessage(worker, {
        createdBy: "user",
        creationSource: "web",
        senderThreadId: yuiThread,
      }),
    ).toBe(false);
    expect(isTotWorkerMessage(worker, { createdBy: "agent", creationSource: "server" })).toBe(
      false,
    );
    expect(
      isTotWorkerMessage(worker, {
        ...fromAgent,
        senderThreadId: totThreadId(TotId.make("home"), "current"),
      }),
    ).toBe(false);
    expect(isTotWorkerMessage("thread:plain", { ...fromAgent, senderThreadId: yuiThread })).toBe(
      false,
    );
  });
});
