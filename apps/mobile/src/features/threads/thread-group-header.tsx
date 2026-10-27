import type { MenuAction } from "@react-native-menu/menu";
import {
  ProjectIconColor,
  ProjectMonogramText,
  type ProjectIconOverride,
  type ThreadGroup,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import {
  countGlyphs,
  projectIconColorClassNames,
  resolveProjectIconSymbol,
} from "../../lib/projectIcon";
import {
  canEditThreadGroup,
  normalizeThreadGroupName,
  threadGroupActions,
  useCollapsedThreadGroups,
  useThreadGroupsView,
} from "../../state/thread-groups";
import type { ThreadListV2GroupListItem } from "./thread-group-header-item";

/** Native menus take color values, not class names. */
export const THREAD_GROUP_SWATCH_HEX: Record<ProjectIconColor, string> = {
  gray: "#6b7280",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

const DOT_CLASS_NAMES: Record<ProjectIconColor, string> = {
  gray: "bg-gray-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-500",
  lime: "bg-lime-500",
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  purple: "bg-purple-500",
  fuchsia: "bg-fuchsia-500",
  pink: "bg-pink-500",
  rose: "bg-rose-500",
};

const isMonogramText = Schema.is(ProjectMonogramText);

const colorTitle = (color: ProjectIconColor) => color.charAt(0).toUpperCase() + color.slice(1);

/** Emoji and monogram as on desktop; desktop-only icons fall back to the group's color dot. */
export function ThreadGroupIcon(props: { readonly group: Pick<ThreadGroup, "color" | "icon"> }) {
  const { icon, color } = props.group;
  if (icon?.kind === "emoji") {
    return <Text className="text-xs leading-none">{icon.emoji}</Text>;
  }
  if (icon?.kind === "image") {
    return (
      <Image
        source={{ uri: icon.dataUrl }}
        cachePolicy="memory"
        style={{ width: 14, height: 14 }}
        contentFit="contain"
      />
    );
  }
  if (icon?.kind === "monogram") {
    const classNames = projectIconColorClassNames(icon.color);
    return (
      <View
        className={cn(
          "h-4 min-w-4 items-center justify-center rounded px-0.5",
          classNames.background,
        )}
      >
        <Text className={cn("font-mono text-[9px] font-t3-bold leading-none", classNames.text)}>
          {icon.text}
        </Text>
      </View>
    );
  }
  const symbol = resolveProjectIconSymbol(icon);
  if (symbol) {
    return (
      <SymbolView
        name={symbol.name}
        size={12}
        tintColorClassName={projectIconColorClassNames(symbol.color).tint}
        type="monochrome"
      />
    );
  }
  const dotColor = (icon?.kind === "lucide" ? icon.color : null) ?? color;
  return dotColor ? (
    <View className={cn("size-2 rounded-full", DOT_CLASS_NAMES[dotColor])} />
  ) : null;
}

function groupMenuActions(group: ThreadGroup): MenuAction[] {
  return [
    { id: "group-rename", title: "Rename…", image: "pencil" },
    {
      id: "group-color",
      title: "Color",
      image: "paintbrush",
      subactions: [
        { id: "group-color:none", title: "None", state: group.color ? "off" : "on" },
        ...ProjectIconColor.literals.map((color): MenuAction => ({
          id: `group-color:${color}`,
          title: colorTitle(color),
          image: "circle.fill",
          imageColor: THREAD_GROUP_SWATCH_HEX[color],
          state: group.color === color ? "on" : "off",
        })),
      ],
    },
    {
      id: "group-icon",
      title: "Icon",
      image: "face.smiling",
      subactions: [
        { id: "group-icon:none", title: "None", state: group.icon ? "off" : "on" },
        {
          id: "group-icon:emoji",
          title: "Emoji…",
          state: group.icon?.kind === "emoji" ? "on" : "off",
        },
        {
          id: "group-icon:monogram",
          title: "Letters…",
          state: group.icon?.kind === "monogram" ? "on" : "off",
        },
      ],
    },
    {
      id: "group-delete",
      title: "Delete group",
      image: "trash",
      attributes: { destructive: true },
    },
  ];
}

function setGroupColor(group: ThreadGroup, color: ProjectIconColor | null) {
  // Like desktop, a lettered or symbol icon takes the group's color.
  const icon =
    group.icon && (group.icon.kind === "lucide" || group.icon.kind === "monogram") && color
      ? { ...group.icon, color }
      : undefined;
  threadGroupActions.update(group.id, { color, ...(icon ? { icon } : {}) });
}

function promptGroupIcon(group: ThreadGroup, kind: "emoji" | "monogram") {
  const current = group.icon?.kind === kind ? group.icon : null;
  Dialog.prompt({
    title: kind === "emoji" ? "Group emoji" : "Group letters",
    message: kind === "emoji" ? "One emoji." : "Up to 3 letters or digits.",
    initialValue:
      current?.kind === "emoji" ? current.emoji : current?.kind === "monogram" ? current.text : "",
    confirmText: "Save",
    onConfirm: (value) => {
      const text = value.trim();
      let icon: ProjectIconOverride | null = null;
      if (kind === "emoji" && text.length > 0 && text.length <= 32) {
        icon = { kind: "emoji", emoji: text };
      }
      if (kind === "monogram" && isMonogramText(text) && countGlyphs(text) <= 3) {
        icon = { kind: "monogram", text, color: group.color ?? "gray" };
      }
      if (icon) threadGroupActions.update(group.id, { icon });
      else if (text.length > 0) Dialog.alert("Icon not saved", "That text cannot be a group icon.");
    },
  });
}

function handleGroupMenuAction(group: ThreadGroup, event: string) {
  if (event === "group-rename") {
    Dialog.prompt({
      title: "Rename group",
      initialValue: group.name,
      confirmText: "Save",
      onConfirm: (value) => {
        const name = normalizeThreadGroupName(value);
        if (name.length > 0 && name !== group.name) threadGroupActions.update(group.id, { name });
      },
    });
  }
  if (event === "group-color:none") setGroupColor(group, null);
  const color = event.startsWith("group-color:") ? event.slice("group-color:".length) : null;
  if (color !== null && (ProjectIconColor.literals as ReadonlyArray<string>).includes(color)) {
    setGroupColor(group, color as ProjectIconColor);
  }
  if (event === "group-icon:none") threadGroupActions.update(group.id, { icon: null });
  if (event === "group-icon:emoji") promptGroupIcon(group, "emoji");
  if (event === "group-icon:monogram") promptGroupIcon(group, "monogram");
  if (event === "group-delete") {
    Dialog.confirm({
      title: `Delete group "${group.name}"?`,
      message: "Its threads and projects stay; they become ungrouped.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => threadGroupActions.delete(group.id),
    });
  }
}

export const ThreadGroupHeader = memo(function ThreadGroupHeader(props: {
  readonly item: ThreadListV2GroupListItem;
  readonly pane?: "screen" | "sidebar";
}) {
  const { group, count, expanded } = props.item;
  const view = useThreadGroupsView();
  const { toggle } = useCollapsedThreadGroups();
  const sidebarPane = props.pane === "sidebar";
  const tint = group.color ? projectIconColorClassNames(group.color) : null;
  const header = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name} group, ${count === 1 ? "1 thread" : `${count} threads`}`}
      accessibilityHint={expanded ? "Collapses this group" : "Expands this group"}
      accessibilityState={{ expanded }}
      className={cn(
        "mb-1 mt-3 flex-row items-center gap-2 rounded-lg px-2 py-1.5",
        sidebarPane ? "mx-1" : "mx-3",
        tint?.background ?? (sidebarPane ? "bg-drawer-border/40" : "bg-subtle"),
      )}
      onPress={() => toggle(group.id)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <ThreadGroupIcon group={group} />
      <Text
        numberOfLines={1}
        className={cn(
          "min-w-0 shrink text-xs font-t3-medium",
          tint?.text ??
            (sidebarPane ? "text-drawer-foreground-muted" : "text-foreground-secondary"),
        )}
      >
        {group.name}
      </Text>
      {expanded ? null : <Text className="text-xs text-foreground-tertiary">{String(count)}</Text>}
      <View className="flex-1" />
      <SymbolView
        name="chevron.down"
        size={10}
        tintColorClassName={
          sidebarPane ? "accent-drawer-foreground-muted" : "accent-foreground-muted"
        }
        type="monochrome"
        style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
      />
    </Pressable>
  );
  if (!canEditThreadGroup(view, group.id)) return header;
  return (
    <Menu
      actions={groupMenuActions(group)}
      onPressAction={({ nativeEvent }) => handleGroupMenuAction(group, nativeEvent.event)}
      shouldOpenOnLongPress
    >
      {header}
    </Menu>
  );
});
