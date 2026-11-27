import {
  companionAvatar,
  companionChannelId,
  companionFaceState,
  companionUnreadCount,
} from "@t3tools/client-runtime/companions";
import type { CompanionAvatar } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { Platform, Pressable, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import {
  companionKey,
  useCompanions,
  useTotsTabDisclosure,
  type EnvironmentCompanion,
} from "../../state/companions";
import { TotStillFace } from "../tots/TotStillFace";
import { TotsTabSectionHeader } from "../tots/TotsTabSectionHeader";

/** A companion's or child's face as mobile draws Tots: BoopFace in the descriptor's colour. */
export function CompanionStillFace(props: {
  readonly avatar: CompanionAvatar | undefined;
  readonly seed: string;
  readonly state: string | undefined;
  readonly online: boolean;
  readonly size: number;
}) {
  return (
    <TotStillFace
      avatar={companionAvatar(props.avatar, props.seed)}
      state={companionFaceState(props.state, props.online)}
      size={props.size}
    />
  );
}

function UnreadBadge(props: { readonly count: number }) {
  const gt = useGT();
  if (props.count <= 0) return null;
  return (
    <View
      accessibilityLabel={gt("{count, plural, one {{count} unread} other {{count} unread}}", {
        count: props.count,
      })}
      className="min-w-5 items-center rounded-full bg-primary px-1.5 py-0.5"
    >
      <Text className="text-[11px] font-t3-semibold tabular-nums text-primary-foreground">
        {props.count > 99 ? "99+" : String(props.count)}
      </Text>
    </View>
  );
}

function CompanionCard(props: {
  readonly entry: EnvironmentCompanion;
  readonly childrenOpen: boolean;
  readonly onToggleChildren: () => void;
}) {
  const { environmentId, companion } = props.entry;
  const gt = useGT();
  const navigation = useNavigation();
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const manifest = companion.manifest;
  const online = companion.connection === "connected";
  const children = manifest?.children ?? [];
  const status =
    companion.connection === "connected"
      ? gt("Connected")
      : companion.connection === "connecting"
        ? gt("Connecting")
        : gt("Offline");
  const open = (channel: string) =>
    navigation.navigate("Companion", { environmentId, companionId: companion.id, channel });
  const childrenLabel =
    manifest?.childrenLabel ?? gt("Children", { $context: "a companion's sub-agents" });
  return (
    <View
      testID={`companion-${companion.id}`}
      className="overflow-hidden rounded-3xl border border-border bg-grouped-card"
    >
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`${companion.label}, ${status}`}
        onPress={() => open("main")}
        android_ripple={{ color: rippleStyle.backgroundColor }}
        unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
        className="flex-row items-center gap-3 px-4 py-3"
      >
        <CompanionStillFace
          avatar={manifest?.avatar}
          seed={companion.id}
          state={companion.avatarStates.main}
          online={online}
          size={40}
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            numberOfLines={1}
            className={cn(
              "text-[15px] font-t3-semibold",
              online ? "text-foreground" : "text-foreground-muted",
            )}
          >
            {companion.label}
          </Text>
          <Text numberOfLines={1} className="text-xs text-foreground-tertiary">
            {online ? (manifest?.tagline ?? status) : status}
          </Text>
        </View>
        {props.childrenOpen ? null : <UnreadBadge count={companionUnreadCount(manifest)} />}
        <SymbolView
          name="chevron.right"
          size={12}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      </RowPressable>
      {children.length === 0 ? null : (
        <Pressable
          testID={`companion-children-${companion.id}`}
          accessibilityRole="button"
          accessibilityLabel={gt("{label}, {count}", {
            label: childrenLabel,
            count: children.length,
          })}
          accessibilityState={{ expanded: props.childrenOpen }}
          onPress={props.onToggleChildren}
          className="flex-row items-center gap-1.5 border-t border-separator px-4 py-2.5"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <SymbolView
            name="chevron.right"
            size={10}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
            style={{ transform: [{ rotate: props.childrenOpen ? "90deg" : "0deg" }] }}
          />
          <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground-secondary">
            {childrenLabel}
          </Text>
          <Text className="text-xs tabular-nums text-foreground-tertiary">
            {String(children.length)}
          </Text>
        </Pressable>
      )}
      {props.childrenOpen
        ? children.map((child) => (
            <RowPressable
              key={child.id}
              testID={`companion-child-${child.id}`}
              accessibilityRole="button"
              accessibilityLabel={child.name}
              onPress={() => open(companionChannelId(child.id))}
              android_ripple={{ color: rippleStyle.backgroundColor }}
              unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
              className="flex-row items-center gap-3 border-t border-separator py-2.5 pe-4 ps-8"
            >
              <CompanionStillFace
                avatar={child.avatar ?? manifest?.avatar}
                seed={`${companion.id}:${child.id}`}
                state={companion.avatarStates[child.id]}
                online={online}
                size={26}
              />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm text-foreground">
                  {child.name}
                </Text>
                {child.role === undefined ? null : (
                  <Text numberOfLines={1} className="text-xs text-foreground-tertiary">
                    {child.role}
                  </Text>
                )}
              </View>
              <UnreadBadge count={child.unreadCount} />
            </RowPressable>
          ))
        : null}
    </View>
  );
}

/** The Tots tab's External Companions: each companion, its children under it. */
export function CompanionsSection() {
  const companions = useCompanions();
  const gt = useGT();
  const disclosure = useTotsTabDisclosure();
  if (companions.length === 0) return null;
  const expanded = disclosure.sectionExpanded("companions");
  return (
    <View className="mt-6">
      <TotsTabSectionHeader
        testID="tots-tab-companions-toggle"
        label={gt("External Companions")}
        count={companions.length}
        expanded={expanded}
        onToggle={() => disclosure.toggleSection("companions")}
      />
      {expanded ? (
        <View className="gap-3">
          {companions.map((entry) => {
            const key = companionKey(entry);
            return (
              <CompanionCard
                key={key}
                entry={entry}
                childrenOpen={disclosure.childrenExpanded(key)}
                onToggleChildren={() => disclosure.toggleChildren(key)}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
