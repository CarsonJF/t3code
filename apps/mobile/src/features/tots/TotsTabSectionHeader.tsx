import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";

/** A Tots tab section's label, rule and chevron, styled like the thread list's shelves. */
export function TotsTabSectionHeader(props: {
  readonly label: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly testID?: string;
}) {
  const gt = useGT();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={gt("{label}, {count}", { label: props.label, count: props.count })}
      accessibilityHint={
        props.expanded ? gt("Collapses this section.") : gt("Expands this section.")
      }
      accessibilityState={{ expanded: props.expanded }}
      onPress={props.onToggle}
      hitSlop={{ top: 8, bottom: 8 }}
      className="mb-3 flex-row items-center gap-2.5 px-1 py-1"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text className="text-xs font-t3-medium text-foreground-tertiary">{props.label}</Text>
      <Text className="text-xs tabular-nums text-foreground-tertiary">{String(props.count)}</Text>
      <View className="h-px flex-1 bg-border" />
      <SymbolView
        name="chevron.down"
        size={10}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
        style={{ transform: [{ rotate: props.expanded ? "180deg" : "0deg" }] }}
      />
    </Pressable>
  );
}
