import { EnvironmentId, type NeedsYouItem, ThreadId, TotId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeNeedsYou, needsYouAge, needsYouAnswers } from "./needsYou.ts";

const asuna = EnvironmentId.make("asuna");
const pc = EnvironmentId.make("pc");
const item = (key: string, fields: Partial<NeedsYouItem> = {}): NeedsYouItem => ({
  key,
  kind: "question",
  threadId: ThreadId.make(`thread:${key}`),
  title: key,
  summary: key,
  at: "2026-11-25T10:00:00.000Z",
  totId: null,
  ...fields,
});
const env = (
  environmentId: EnvironmentId,
  items: ReadonlyArray<NeedsYouItem>,
  fields: { local?: boolean; error?: string | null } = {},
) => ({
  environmentId,
  label: environmentId === asuna ? "Asuna" : "PC",
  local: fields.local ?? true,
  error: fields.error ?? null,
  tots: [{ id: TotId.make("yui"), name: "Yui" }],
  items,
});

describe("mergeNeedsYou", () => {
  it("gives each companion its own section, apart from Tots and threads", () => {
    const companion = (key: string, companionId: string, name: string) =>
      item(key, {
        kind: "companion",
        threadId: null,
        companion: {
          companionId,
          name,
          needsYouId: key,
          channel: "main",
          kind: "approval",
          options: [],
        },
      });
    const merged = mergeNeedsYou(
      [
        {
          sourceEnvironmentId: asuna,
          inbox: {
            environments: [
              env(asuna, [
                item("t1"),
                companion("c1", "demo", "Demo"),
                companion("c2", "demo", "Demo"),
                companion("c3", "other", "Another"),
              ]),
            ],
          },
        },
      ],
      new Set([asuna]),
    );
    expect(merged.count).toBe(4);
    expect(
      merged.machines[0]?.sections.map((section) => [
        section.totName,
        section.companionId,
        section.items.map((entry) => entry.key),
      ]),
    ).toEqual([
      ["Another", "other", ["c3"]],
      ["Demo", "demo", ["c1", "c2"]],
      [null, null, ["t1"]],
    ]);
  });

  it("keeps a connected environment's own list over how a linked one saw it", () => {
    const merged = mergeNeedsYou(
      [
        {
          sourceEnvironmentId: asuna,
          inbox: {
            environments: [
              env(asuna, [item("a1", { totId: TotId.make("yui") }), item("a2")]),
              // The PC dismissed p1 itself, so Asuna's copy must not bring it back.
              env(pc, [item("p1"), item("p2")], { local: false }),
            ],
          },
        },
        {
          sourceEnvironmentId: pc,
          inbox: { environments: [env(pc, [item("p2"), item("p1", { hiddenUntil: null })])] },
        },
      ],
      new Set([asuna, pc]),
    );
    expect(merged.count).toBe(3);
    expect(
      merged.machines.map((machine) => [
        machine.label,
        machine.via,
        machine.sections.map((section) => [section.totName, section.items.map((i) => i.key)]),
        machine.hidden.map((i) => i.key),
      ]),
    ).toEqual([
      [
        "Asuna",
        asuna,
        [
          ["Yui", ["a1"]],
          [null, ["a2"]],
        ],
        [],
      ],
      ["PC", pc, [[null, ["p2"]]], ["p1"]],
    ]);
  });

  it("shows a linked environment through the one that reached it", () => {
    const merged = mergeNeedsYou(
      [
        {
          sourceEnvironmentId: asuna,
          inbox: { environments: [env(asuna, []), env(pc, [item("p1")], { local: false })] },
        },
      ],
      new Set([asuna]),
    );
    expect(merged.machines.find((machine) => machine.environmentId === pc)).toMatchObject({
      via: asuna,
      connected: false,
    });
    expect(merged.count).toBe(1);
  });
});

describe("needsYouAnswers", () => {
  const question = { id: "q", header: "H", question: "Q?", options: [] };
  it("answers only once every required question has text", () => {
    expect(needsYouAnswers([question], {})).toBeNull();
    expect(needsYouAnswers([question], { q: "  main " })).toEqual({ q: "main" });
    expect(needsYouAnswers([{ ...question, required: false }], {})).toEqual({ q: "" });
  });
});

describe("needsYouAge", () => {
  it("reads minutes, hours, then days", () => {
    const at = "2026-11-25T10:00:00.000Z";
    const base = Date.parse(at);
    expect(needsYouAge(at, base + 5 * 60_000)).toBe("5m");
    expect(needsYouAge(at, base + 3 * 3_600_000)).toBe("3h");
    expect(needsYouAge(at, base + 72 * 3_600_000)).toBe("3d");
  });
});
