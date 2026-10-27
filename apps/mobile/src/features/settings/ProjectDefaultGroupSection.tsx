import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { projectDefaultGroupId } from "@t3tools/client-runtime/thread-groups";
import { View } from "react-native";

import {
  promptNewThreadGroup,
  threadGroupActions,
  useThreadGroupsView,
} from "../../state/thread-groups";
import { SettingsActionRow } from "./components/SettingsActionRow";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsSection } from "./components/SettingsSection";

/** Sets the sidebar group new threads of every checkout start in, as on desktop. */
export function ProjectDefaultGroupSection(props: {
  readonly members: readonly EnvironmentProject[];
}) {
  const view = useThreadGroupsView();
  const defaults = props.members.map((member) => {
    const state = view.byEnvironment.get(member.environmentId);
    return state === undefined ? undefined : projectDefaultGroupId(state, member.id);
  });
  if (defaults.length === 0 || defaults.includes(undefined)) return null;
  const canEdit = props.members.every((member) =>
    view.writableEnvironmentIds.has(member.environmentId),
  );
  if (!canEdit && view.groups.length === 0) return null;
  const mixed = new Set(defaults).size > 1;
  const selected = mixed ? undefined : defaults[0];
  const footer =
    "New threads in this project start in this group. Existing threads stay where they are.";
  return (
    <SettingsSection
      title="Default group"
      footer={mixed ? `Checkouts use different groups. ${footer}` : footer}
    >
      <SettingsChoiceRow
        label="No group"
        selected={selected === null}
        disabled={!canEdit}
        onPress={() => threadGroupActions.setProjectDefault(props.members, null)}
      />
      {view.groups.map((group) => (
        <SettingsChoiceRow
          key={group.id}
          label={group.name}
          selected={selected === group.id}
          separated
          disabled={!canEdit}
          onPress={() => threadGroupActions.setProjectDefault(props.members, group)}
        />
      ))}
      {canEdit ? (
        <View className="border-t border-border-subtle">
          <SettingsActionRow
            icon="plus"
            label="New group…"
            onPress={() =>
              promptNewThreadGroup((group) =>
                threadGroupActions.setProjectDefault(props.members, group),
              )
            }
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
