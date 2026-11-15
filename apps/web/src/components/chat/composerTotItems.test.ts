import type { EnvironmentTot } from "@t3tools/client-runtime/tots";
import { EnvironmentId, HOME_TOT_ID, TotId, totThreadId, type Tot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchComposerTotItems, orderComposerMentionItems } from "./composerTotItems";

const here = EnvironmentId.make("env-here");
const vps = EnvironmentId.make("env-vps");
const workBot = TotId.make("work-bot");
const nightShift = TotId.make("night-shift");
const offTot = TotId.make("off");

function tot(
  id: Tot["id"],
  name: string,
  overrides: Partial<Tot> = {},
  environmentId: EnvironmentId = here,
): EnvironmentTot & { tot: Tot } {
  return {
    environmentId,
    tot: {
      id,
      name,
      avatar: { color: "#0A7EA4" },
      scope: "all",
      instructions: "",
      projectId: null,
      threadId: totThreadId(id, "1"),
      modelSelection: null,
      watchAll: false,
      watches: [],
      ...overrides,
    },
  };
}

const tots = [
  tot(HOME_TOT_ID, "Home"),
  tot(workBot, "Work bot"),
  tot(nightShift, "Night Shift", {}, vps),
  tot(offTot, "Off Tot", { threadId: null }),
];

describe("matchComposerTotItems", () => {
  it("filters by name, trims the query, and skips Tots that cannot answer", () => {
    expect(
      matchComposerTotItems({
        tots,
        environmentId: here,
        excludeThreadId: null,
        environmentLabels: new Map([[vps, "Asuna"]]),
        query: "  WORK ",
      }).map((item) => [item.totId, item.label, item.description, item.thread]),
    ).toEqual([
      ["work-bot", "Work bot", "Tot", { environmentId: here, threadId: totThreadId(workBot, "1") }],
    ]);
    expect(
      matchComposerTotItems({
        tots,
        environmentId: here,
        excludeThreadId: null,
        environmentLabels: new Map([[vps, "Asuna"]]),
        query: "off",
      }),
    ).toEqual([]);
  });

  it("names the machine of a Tot hosted elsewhere", () => {
    const [item] = matchComposerTotItems({
      tots,
      environmentId: here,
      excludeThreadId: null,
      environmentLabels: new Map([[vps, "Asuna"]]),
      query: "night",
    });
    expect(item).toMatchObject({
      type: "tot",
      environmentId: vps,
      description: "Tot on Asuna",
      thread: { environmentId: vps, threadId: totThreadId(nightShift, "1") },
    });
  });

  it("leaves out the Tot whose thread is being written in and keeps bare @ for files", () => {
    const homeThread = totThreadId(HOME_TOT_ID, "1");
    expect(
      matchComposerTotItems({
        tots,
        environmentId: here,
        excludeThreadId: homeThread,
        environmentLabels: new Map(),
        query: "home",
      }),
    ).toEqual([]);
    expect(
      matchComposerTotItems({
        tots,
        environmentId: here,
        excludeThreadId: null,
        environmentLabels: new Map(),
        query: "",
      }),
    ).toEqual([]);
  });
});

describe("orderComposerMentionItems", () => {
  const groups = {
    tots: ["tot"],
    environments: ["environment"],
    threads: ["thread"],
    rest: ["model", "path"],
  };

  it("puts Tots and machines first in a Tot's own thread", () => {
    expect(orderComposerMentionItems({ ...groups, isTotChat: true })).toEqual([
      "tot",
      "environment",
      "thread",
      "model",
      "path",
    ]);
  });

  it("keeps threads first everywhere else", () => {
    expect(orderComposerMentionItems({ ...groups, isTotChat: false })).toEqual([
      "thread",
      "tot",
      "environment",
      "model",
      "path",
    ]);
  });
});
