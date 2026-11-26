/**
 * Who started a turn from outside the app: another Tot or agent, a linked environment, a
 * webhook, the Discord bridge or another outside client. The local user and T3 Code itself
 * never carry one. A Tot's "Who can ask" list is keyed on these.
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TURN_CALLER_ORIGINS = [
  "tot",
  "agent",
  "linked",
  "webhook",
  "discord",
  "companion",
] as const;
export const TurnCallerOrigin = Schema.Literals(TURN_CALLER_ORIGINS);
export type TurnCallerOrigin = typeof TurnCallerOrigin.Type;

export const TurnCaller = Schema.Struct({
  origin: TurnCallerOrigin,
  /** A Tot id, a thread id, an environment id, a scheduled task id, a Discord user id or a client's label. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type TurnCaller = typeof TurnCaller.Type;

/**
 * How far a run from an outside caller is limited: `ask` runs in approval-required mode,
 * `read-only` in a read-only sandbox with nothing to approve. Either way T3 Code's own
 * write tools refuse it. Absent: the thread's own mode.
 */
export const RunRestriction = Schema.Literals(["ask", "read-only"]);
export type RunRestriction = typeof RunRestriction.Type;
