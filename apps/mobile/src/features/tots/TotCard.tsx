import { TOT_FACE_STATE_LABELS, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { TotFaceState } from "@t3tools/contracts";
import { Platform, Pressable, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { RowPressable } from "../../components/ui/RowPressable";
import { TOT_STATE_PRESENTATION } from "./totStatePresentation";
import { TotLiveFace } from "./TotLiveFace";
import { TotStatePill } from "./TotStatePill";
import { TotStillFace } from "./TotStillFace";

/** Big enough that its eyes read at arm's length, on a phone and on a Fold. */
const FACE_SIZE = 64;
export const TOT_CARD_MIN_HEIGHT = 172;

/**
 * One Tot in the Tots tab: its face, its name, what it is doing. The whole card opens the Tot;
 * the small slider in the corner is the secondary trip to its editor.
 */
export function TotCard(props: {
  readonly entry: EnvironmentTot;
  readonly state: TotFaceState;
  readonly machine: string | null;
  readonly width: number;
  readonly animate: boolean;
  readonly onOpen: () => void;
  readonly onEdit: () => void;
}) {
  const { tot } = props.entry;
  const accent = tot.avatar.color;
  const presentation = TOT_STATE_PRESENTATION[props.state];
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  // A moving face costs a WebView, so only a Tot that is actually doing something gets one.
  const live = props.animate && (props.state === "working" || props.state === "needs-you");
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={[
        tot.name,
        TOT_FACE_STATE_LABELS[props.state],
        props.machine === null ? null : `on ${props.machine}`,
      ]
        .filter((part) => part !== null)
        .join(", ")}
      accessibilityHint={tot.threadId === null ? "Opens its editor" : "Opens its conversation"}
      onPress={props.onOpen}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className={`rounded-3xl border bg-grouped-card ${presentation.cardClassName}`}
      style={{ width: props.width, minHeight: TOT_CARD_MIN_HEIGHT }}
    >
      <View className="flex-1 items-center justify-center gap-2.5 px-3 pb-4 pt-5">
        <View
          className="items-center justify-center"
          style={{ padding: 6, borderRadius: 30, backgroundColor: `${accent}24` }}
        >
          {live ? (
            <TotLiveFace avatar={tot.avatar} state={props.state} size={FACE_SIZE} animate />
          ) : (
            <TotStillFace avatar={tot.avatar} state={props.state} size={FACE_SIZE} />
          )}
        </View>
        <AppText numberOfLines={1} className="text-[15px] font-t3-semibold text-foreground">
          {tot.name}
        </AppText>
        <TotStatePill state={props.state} accent={accent} />
        {props.machine === null ? null : (
          <AppText numberOfLines={1} className="text-xs text-foreground-tertiary">
            {props.machine}
          </AppText>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${tot.name}`}
        onPress={props.onEdit}
        hitSlop={10}
        className="absolute right-1.5 top-1.5 size-10 items-center justify-center"
      >
        <SymbolView
          name="slider.horizontal.3"
          size={16}
          tintColorClassName="accent-foreground-tertiary"
          type="monochrome"
        />
      </Pressable>
    </RowPressable>
  );
}
