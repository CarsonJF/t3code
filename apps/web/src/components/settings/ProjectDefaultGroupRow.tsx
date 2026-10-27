import { projectDefaultGroupId } from "@t3tools/client-runtime/thread-groups";
import type { ScopedProjectRef } from "@t3tools/contracts";

import { threadGroupActions, useThreadGroupsStore } from "../../threadGroupsStore";
import { createThreadGroupFromPrompt } from "../ThreadGroupNameDialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";

const NO_GROUP = "none";
const NEW_GROUP = "new";

export function ProjectDefaultGroupRow({
  memberProjectRefs,
}: {
  memberProjectRefs: readonly ScopedProjectRef[];
}) {
  const state = useThreadGroupsStore();
  const defaults = new Set(
    memberProjectRefs.map((ref) => {
      const environmentState = state.byEnvironment.get(ref.environmentId);
      return environmentState ? projectDefaultGroupId(environmentState, ref.projectId) : null;
    }),
  );
  const current = defaults.size === 1 ? ([...defaults][0] ?? NO_GROUP) : null;
  const labels = new Map(state.groups.map((group) => [group.id, group.name]));
  return (
    <SettingsRow
      title="Default group"
      description="New threads in this project start in this sidebar group. Existing threads stay where they are."
      control={
        <Select
          value={current}
          onValueChange={(value) => {
            if (value === NEW_GROUP) {
              void createThreadGroupFromPrompt().then((group) => {
                if (group !== null) threadGroupActions.setProjectDefault(memberProjectRefs, group);
              });
            } else if (value === NO_GROUP) {
              threadGroupActions.setProjectDefault(memberProjectRefs, null);
            } else {
              const group = state.groups.find((candidate) => candidate.id === value);
              if (group) threadGroupActions.setProjectDefault(memberProjectRefs, group);
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Default group">
            <SelectValue>
              {(value: string | null) =>
                value === null ? "Mixed" : (labels.get(value) ?? "No group")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value={NO_GROUP}>No group</SelectItem>
            {state.groups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
            <SelectItem value={NEW_GROUP}>New group…</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}
