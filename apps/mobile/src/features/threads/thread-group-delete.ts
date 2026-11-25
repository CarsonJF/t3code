import {
  environmentsWithThreadGroup,
  threadGroupProjectCount,
  type ThreadGroupsByEnvironment,
} from "@t3tools/client-runtime/thread-groups";
import type { EnvironmentId, ThreadGroup } from "@t3tools/contracts";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface ThreadGroupDeleteChoice {
  readonly label: string;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}

/**
 * What to ask before deleting `group`. The phone has no primary machine, so the first machine
 * holding the group is the default, and a second choice removes it from every machine.
 */
export function threadGroupDeletePrompt(input: {
  readonly group: ThreadGroup;
  readonly threadCount: number;
  readonly byEnvironment: ThreadGroupsByEnvironment;
  readonly labelOf: (environmentId: EnvironmentId) => string;
}): {
  readonly title: string;
  readonly message: string;
  readonly choices: ReadonlyArray<ThreadGroupDeleteChoice>;
} | null {
  const holders = environmentsWithThreadGroup(input.byEnvironment, input.group.id);
  const [first] = holders;
  if (first === undefined) return null;
  const labels = holders.map(input.labelOf);
  const projectCount = threadGroupProjectCount(input.byEnvironment, input.group.id);
  return {
    title: `Delete group "${input.group.name}"?`,
    message: [
      `It holds ${plural(projectCount, "project", "projects")} and ${plural(input.threadCount, "thread", "threads")}. They stay; they become ungrouped.`,
      `It is on ${labels.join(", ")}.`,
    ].join("\n\n"),
    choices:
      holders.length === 1
        ? [{ label: "Delete", environmentIds: holders }]
        : [
            { label: `Only on ${labels[0]}`, environmentIds: [first] },
            { label: "All machines", environmentIds: holders },
          ],
  };
}
