import {
  LOOK_AROUND_DEFAULT_SCHEDULE,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ScheduledTaskId,
  TotId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  lookAroundDraft,
  lookAroundSchedule,
  lookAroundSupport,
  lookAroundUpsert,
} from "./lookAround.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };
const tot = { id: TotId.make("ci"), projectId: ProjectId.make("tot-ci"), modelSelection };

describe("Look around", () => {
  it("starts from the default: off, every 4 h on weekdays from 08:00 to 20:00", () => {
    const draft = lookAroundDraft(undefined);
    expect(draft).toMatchObject({ enabled: false, everyHours: "4", weekdaysOnly: true });
    expect(lookAroundSchedule(draft)).toEqual({ ok: true, schedule: LOOK_AROUND_DEFAULT_SCHEDULE });
  });

  it("saves a read-only sweep in the Tot's folder on its model", () => {
    const draft = {
      ...lookAroundDraft(undefined),
      enabled: true,
      focus: " CI on the fork ",
      precheck: "",
    };
    const schedule = { type: "interval" as const, everyMs: 7_200_000 };
    expect(lookAroundUpsert({ draft, schedule, tot, task: undefined })).toMatchObject({
      prompt: "CI on the fork",
      enabled: true,
      readOnly: true,
      projectId: tot.projectId,
      createdByTotId: tot.id,
      modelSelection,
      precheck: null,
    });
    expect(
      lookAroundUpsert({ draft, schedule, tot: { ...tot, projectId: null }, task: undefined }),
    ).toBeNull();
    const task = { id: ScheduledTaskId.make("task:sweep"), title: "Look around" } as ScheduledTask;
    expect(lookAroundUpsert({ draft, schedule, tot, task })).toMatchObject({
      id: task.id,
      requireExisting: true,
    });
  });

  it("refuses an hour count or window it cannot schedule", () => {
    const draft = lookAroundDraft(undefined);
    expect(lookAroundSchedule({ ...draft, everyHours: "0" })).toEqual({
      ok: false,
      problem: "hours",
    });
    expect(lookAroundSchedule({ ...draft, to: "25:00" })).toEqual({ ok: false, problem: "window" });
    expect(lookAroundSchedule({ ...draft, from: "", to: "", weekdaysOnly: false })).toEqual({
      ok: true,
      schedule: { type: "interval", everyMs: 4 * 3_600_000 },
    });
  });

  it("says whether the Tot's provider can keep a sweep read-only", () => {
    const provider = (driver: string) => [
      { instanceId: modelSelection.instanceId, driver: ProviderDriverKind.make(driver) },
    ];
    expect(lookAroundSupport(tot, provider("codex"))).toBe("supported");
    expect(lookAroundSupport(tot, provider("opencode"))).toBe("unsupported");
    expect(lookAroundSupport(tot, [])).toBe("unknown");
  });
});
