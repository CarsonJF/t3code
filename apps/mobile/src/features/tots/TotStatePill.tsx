import { TOT_FACE_STATE_LABELS } from "@t3tools/client-runtime/tots";
import type { TotFaceState } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { TOT_STATE_PRESENTATION } from "./totStatePresentation";

/** What a Tot is doing, in the same shape on its card and above its conversation. */
export function TotStatePill(props: {
  readonly state: TotFaceState;
  /** The Tot's own colour, used for the state it is in most. */
  readonly accent: string;
  readonly size?: "card" | "band";
}) {
  const presentation = TOT_STATE_PRESENTATION[props.state];
  return (
    <View
      className={cn("flex-row items-center rounded-full px-2.5 py-1", presentation.pillClassName)}
    >
      <AppText
        numberOfLines={1}
        className={cn(
          "font-t3-medium",
          props.size === "band" ? "text-[13px]" : "text-xs",
          presentation.textClassName,
        )}
        style={presentation.accentText ? { color: props.accent } : undefined}
      >
        {TOT_FACE_STATE_LABELS[props.state]}
      </AppText>
    </View>
  );
}
