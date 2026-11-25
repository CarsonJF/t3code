import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ScheduledTaskUpsertSchedule } from "./scheduledTask.ts";
import { TotAvatar } from "./tots.ts";

export const TotTemplateId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/),
);
export type TotTemplateId = typeof TotTemplateId.Type;

/** A suggested routine. Templates create it paused, bound to the Tot's own thread. */
export const TotTemplateScheduledTask = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  prompt: TrimmedNonEmptyString,
  schedule: ScheduledTaskUpsertSchedule,
});
export type TotTemplateScheduledTask = typeof TotTemplateScheduledTask.Type;

/** A starting point for a new Tot. Built-in templates live as JSON files in `@t3tools/shared`. */
export const TotTemplate = Schema.Struct({
  id: TotTemplateId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  /** `all` suggests Everything; `projects` asks the user to pick projects. */
  scope: Schema.Literals(["all", "projects"]),
  avatar: TotAvatar,
  instructions: Schema.String.check(Schema.isMaxLength(20_000)),
  scheduledTasks: Schema.Array(TotTemplateScheduledTask).check(Schema.isMaxLength(5)),
});
export type TotTemplate = typeof TotTemplate.Type;
