import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TotId,
  totThreadId,
  type ScheduledTask,
  type ScheduledTaskWebhookFilter,
  type Tot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  scheduledTaskBelongsToTot,
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

const task = (projectId: string, threadId: string | null) =>
  ({
    projectId: ProjectId.make(projectId),
    threadId: threadId === null ? null : ThreadId.make(threadId),
  }) satisfies Pick<ScheduledTask, "projectId" | "threadId">;

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
