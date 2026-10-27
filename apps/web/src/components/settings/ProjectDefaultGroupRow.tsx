import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";

import {
  projectDefaultGroupId,
  threadGroupActions,
  useThreadGroupsStore,
} from "../../threadGroupsStore";
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
  const projectKeys = memberProjectRefs.map(scopedProjectKey);
  const defaults = new Set(projectKeys.map((key) => projectDefaultGroupId(state, key)));
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
              void createThreadGroupFromPrompt().then((groupId) => {
                if (groupId !== null) threadGroupActions.setProjectDefault(projectKeys, groupId);
              });
            } else if (value !== null) {
              threadGroupActions.setProjectDefault(projectKeys, value === NO_GROUP ? null : value);
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
