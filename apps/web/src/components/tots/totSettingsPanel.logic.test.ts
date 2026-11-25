import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TotId,
  TOT_THEME_MAX_LENGTH,
  totThreadId,
  type ScheduledTask,
  type ScheduledTaskWebhookFilter,
  type Tot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  finishedOneOffTasks,
  scheduledTaskBelongsToTot,
  scheduledTaskScopeLabel,
  totIdleCompactionChoice,
  totIdleCompactionValue,
  totSettingsDraftErrors,
  totSettingsDraftFromTot,
  totSettingsDraftKey,
  totSettingsDraftUpdate,
  webhookFilterSummary,
} from "./totSettingsPanel.logic";

const yui = TotId.make("yui");
const totProject = ProjectId.make("tot-yui");
const tot: Tot = {
  id: yui,
  name: "Yui",
  avatar: { color: "#0A7EA4" },
  scope: "all",
  instructions: "Warm and brief.",
  projectId: totProject,
  threadId: totThreadId(yui, "one"),
  modelSelection: null,
  watchAll: false,
  watches: [],
};

const task = (projectId: string, threadId: string | null, createdByTotId?: TotId) =>
  ({
    projectId: ProjectId.make(projectId),
    threadId: threadId === null ? null : ThreadId.make(threadId),
    ...(createdByTotId === undefined ? {} : { createdByTotId }),
  }) satisfies Pick<ScheduledTask, "projectId" | "threadId" | "createdByTotId">;

describe("tot settings draft", () => {
  it("tracks edits but ignores scope order and color case", () => {
    const draft = totSettingsDraftFromTot(tot);
    const key = totSettingsDraftKey(draft);
    expect(
      totSettingsDraftKey({
        ...draft,
        scope: {
          groups: ["B", "A"],
          projects: [
            { environmentId: EnvironmentId.make("two"), projectId: ProjectId.make("b") },
            { environmentId: EnvironmentId.make("one"), projectId: ProjectId.make("a") },
          ],
        },
      }),
    ).toBe(
      totSettingsDraftKey({
        ...draft,
        avatar: { color: "#0a7ea4" },
        scope: {
          groups: ["A", "B"],
          projects: [
            { environmentId: EnvironmentId.make("one"), projectId: ProjectId.make("a") },
            { environmentId: EnvironmentId.make("two"), projectId: ProjectId.make("b") },
          ],
        },
      }),
    );
    expect(key).not.toBe(totSettingsDraftKey({ ...draft, instructions: "Changed." }));
    expect(key).not.toBe(
      totSettingsDraftKey({
        ...draft,
        avatar: { ...draft.avatar, accessories: [{ kind: "glasses" }] },
      }),
    );
    // Accessory colors compare like the head's: case does not make a new face.
    expect(
      totSettingsDraftKey({
        ...draft,
        avatar: { ...draft.avatar, accessories: [{ kind: "halo", color: "#FFD166" }] },
      }),
    ).toBe(
      totSettingsDraftKey({
        ...draft,
        avatar: { ...draft.avatar, accessories: [{ kind: "halo", color: "#ffd166" }] },
      }),
    );
  });

  it("requires a name, a hex color, and something to scope", () => {
    const draft = totSettingsDraftFromTot(tot);
    expect(totSettingsDraftErrors({ ...draft, name: "  " })).toMatchObject({
      name: "Give the Tot a name.",
    });
    expect(totSettingsDraftErrors({ ...draft, avatar: { color: "blue" } })).toMatchObject({
      color: "Pick a color like #0A7EA4.",
    });
    expect(totSettingsDraftErrors({ ...draft, scope: { projects: [], groups: [] } })).toMatchObject(
      { scope: "Pick at least one project or group, or Everything." },
    );
    expect(totSettingsDraftErrors(draft)).toEqual({});
  });

  it("trims the name before saving", () => {
    expect(totSettingsDraftUpdate({ ...totSettingsDraftFromTot(tot), name: "  Yui  " }).name).toBe(
      "Yui",
    );
  });

  it("edits the memory tidy-up, off until a Tot turns it on", () => {
    const draft = totSettingsDraftFromTot(tot);
    expect(draft.memoryTidy).toBe(false);
    expect(totSettingsDraftKey({ ...draft, memoryTidy: true })).not.toBe(
      totSettingsDraftKey(draft),
    );
    expect(totSettingsDraftUpdate({ ...draft, memoryTidy: true }).memoryTidy).toBe(true);
    expect(totSettingsDraftFromTot({ ...tot, memoryTidy: true }).memoryTidy).toBe(true);
  });

  it("edits watch reports, auto-settle and idle compaction, each at its default until set", () => {
    const draft = totSettingsDraftFromTot(tot);
    expect(draft.watchReports).toBe("launched");
    expect(totSettingsDraftKey({ ...draft, watchReports: "off" })).not.toBe(
      totSettingsDraftKey(draft),
    );
    expect(totSettingsDraftUpdate({ ...draft, watchReports: "off" }).watchReports).toBe("off");
    expect(draft.autoSettle).toBe(false);
    expect(totSettingsDraftKey({ ...draft, autoSettle: true })).not.toBe(
      totSettingsDraftKey(draft),
    );
    expect(totSettingsDraftUpdate({ ...draft, autoSettle: true }).autoSettle).toBe(true);
    expect(draft.idleCompaction).toBe(null);
    expect(totSettingsDraftKey({ ...draft, idleCompaction: false })).not.toBe(
      totSettingsDraftKey(draft),
    );
    expect(totSettingsDraftUpdate({ ...draft, idleCompaction: false }).idleCompaction).toBe(false);
    expect(totSettingsDraftFromTot({ ...tot, idleCompaction: true }).idleCompaction).toBe(true);
    for (const value of [null, true, false]) {
      expect(totIdleCompactionValue(totIdleCompactionChoice(value))).toBe(value);
    }
    expect(totSettingsDraftFromTot({ ...tot, watchReports: "explicit" }).watchReports).toBe(
      "explicit",
    );
  });
});

describe("tot theme draft", () => {
  it("reads a stored theme into a draft and tracks edits", () => {
    const themed: Tot = {
      ...tot,
      theme: { css: ":root { color: red; }", effect: "glow" },
    };
    const draft = totSettingsDraftFromTot(themed);
    expect(draft.theme).toEqual({ css: ":root { color: red; }", effect: "glow" });
    expect(
      totSettingsDraftKey({ ...draft, theme: { ...draft.theme, css: ":root { color: blue; }" } }),
    ).not.toBe(totSettingsDraftKey(draft));
  });

  it("leaves a field empty to clear it, without touching the other", () => {
    const draft = totSettingsDraftFromTot({
      ...tot,
      theme: { css: ":root { color: red; }", effect: "glow" },
    });
    expect(totSettingsDraftUpdate({ ...draft, theme: { ...draft.theme, css: "" } }).theme).toEqual({
      css: "",
      effect: "glow",
    });
    expect(totSettingsDraftFromTot(tot).theme).toEqual({ css: "", effect: "" });
  });

  it("refuses CSS or an effect over the cap, and CSS that loads files", () => {
    const draft = totSettingsDraftFromTot(tot);
    expect(
      totSettingsDraftErrors({ ...draft, theme: { ...draft.theme, css: "a".repeat(20_001) } }),
    ).toMatchObject({ themeCss: expect.stringContaining(TOT_THEME_MAX_LENGTH.toLocaleString()) });
    expect(
      totSettingsDraftErrors({ ...draft, theme: { ...draft.theme, effect: "a".repeat(20_001) } }),
    ).toMatchObject({
      themeEffect: expect.stringContaining(TOT_THEME_MAX_LENGTH.toLocaleString()),
    });
    expect(
      totSettingsDraftErrors({
        ...draft,
        theme: { ...draft.theme, css: "@import url(https://example.com/a.css);" },
      }),
    ).toMatchObject({ themeCss: "CSS cannot load files. Use data: or #id for url()." });
    expect(totSettingsDraftErrors(draft)).toEqual({});
  });
});

describe("scheduledTaskBelongsToTot", () => {
  it("matches every thread the Tot has had", () => {
    expect(scheduledTaskBelongsToTot(task("other", totThreadId(yui, "two")), tot)).toBe(true);
    expect(
      scheduledTaskBelongsToTot(task("other", totThreadId(TotId.make("bob"), "two")), tot),
    ).toBe(false);
  });

  it("matches the Tot's own project, including tasks for a new thread", () => {
    expect(scheduledTaskBelongsToTot(task("tot-yui", null), tot)).toBe(true);
    expect(scheduledTaskBelongsToTot(task("other", null), tot)).toBe(false);
    expect(scheduledTaskBelongsToTot(task("tot-yui", null), { ...tot, projectId: null })).toBe(
      false,
    );
  });

  it("matches a task the Tot created through MCP in another project", () => {
    expect(scheduledTaskBelongsToTot(task("t3code", null, yui), tot)).toBe(true);
    expect(
      scheduledTaskBelongsToTot(task("t3code", totThreadId(TotId.make("bob"), "two"), yui), tot),
    ).toBe(true);
    expect(scheduledTaskBelongsToTot(task("t3code", null, TotId.make("bob")), tot)).toBe(false);
  });
});

describe("scheduledTaskScopeLabel", () => {
  it("names this thread, a known project, or a project's id tail", () => {
    expect(scheduledTaskScopeLabel(task("other", tot.threadId), tot, "Other project")).toBe(
      "this thread",
    );
    expect(scheduledTaskScopeLabel(task("project:app", null), tot, "App")).toBe("App");
    expect(scheduledTaskScopeLabel(task("project:app", null), tot, undefined)).toBe(
      "another project · ject:app",
    );
  });
});

describe("finishedOneOffTasks", () => {
  const scheduled = (
    schedule: ScheduledTask["schedule"],
    lastRunAt: string | null,
    nextRunAt: string | null,
  ) => ({ schedule, lastRunAt, nextRunAt });

  it("keeps only one-off tasks that ran and will not run again", () => {
    const finished = scheduled(
      { type: "once", runAt: "2026-11-16T09:00:00.000Z" },
      "2026-11-16T09:00:01.000Z",
      null,
    );
    const notYet = scheduled(
      { type: "once", runAt: "2026-11-20T09:00:00.000Z" },
      null,
      "2026-11-20T09:00:00.000Z",
    );
    const stillScheduled = scheduled(
      { type: "once", runAt: "2026-11-20T09:00:00.000Z" },
      "2026-11-20T09:00:01.000Z",
      "2026-11-20T09:00:00.000Z",
    );
    const recurring = scheduled(
      { type: "interval", everyMs: 60_000 },
      "2026-11-16T09:00:01.000Z",
      null,
    );
    const webhook = scheduled(
      { type: "webhook", signature: null },
      "2026-11-16T09:00:01.000Z",
      null,
    );
    expect(finishedOneOffTasks([finished, notYet, stillScheduled, recurring, webhook])).toEqual([
      finished,
    ]);
  });
});

describe("webhookFilterSummary", () => {
  it("describes no filters as any request", () => {
    expect(webhookFilterSummary(undefined)).toBe("Any request");
    expect(webhookFilterSummary([])).toBe("Any request");
  });

  it("describes each filter operation", () => {
    const filters: ReadonlyArray<ScheduledTaskWebhookFilter> = [
      { path: "body.action", op: "equals", value: "opened" },
      { path: "headers.x-event", op: "exists" },
      { path: "body.labels", op: "in", value: ["bug", "urgent"] },
      { path: "body.state", op: "notEquals", value: "closed" },
      { path: "body.ref", op: "startsWith", value: "refs/heads/" },
    ];
    expect(webhookFilterSummary(filters)).toBe(
      "body.action = opened · headers.x-event exists · body.labels is one of bug, urgent · body.state ≠ closed · body.ref starts with refs/heads/",
    );
  });
});
