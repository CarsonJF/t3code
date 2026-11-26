import {
  TOT_OBJECTIVE_STATUSES,
  type TotObjective,
  type TotObjectiveStatus,
} from "@t3tools/contracts";

/** What the panel shows first: what needs the user, then live work, then what has ended. */
const GROUP_ORDER: ReadonlyArray<TotObjectiveStatus> = [
  "needs_you",
  "working",
  "waiting",
  "planned",
  "failed",
  "done",
  "cancelled",
];

export function workListGroups(objectives: ReadonlyArray<TotObjective>) {
  return GROUP_ORDER.filter((status) => TOT_OBJECTIVE_STATUSES.includes(status)).flatMap(
    (status) => {
      const inGroup = objectives
        .filter((objective) => objective.status === status)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return inGroup.length === 0 ? [] : [{ status, objectives: inGroup }];
    },
  );
}
