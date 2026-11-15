import { TOT_FACE_STATE_LABELS, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { useTotFace } from "../../state/tots";
import { TotLiveFace } from "./TotLiveFace";

const FACE_SIZE = 36;
const FACE_RING = 1.5;

/** How tall the pinned identity band is, so the feed can clear it. */
export const TOT_THREAD_HEADER_HEIGHT = 52;

/** The Tot you are talking to: its face, name and what it is doing, above its thread. */
export function TotThreadHeader(props: {
  readonly entry: EnvironmentTot;
  readonly animate: boolean;
}) {
  const { tot } = props.entry;
  const state = useTotFace(props.entry);
  const label = TOT_FACE_STATE_LABELS[state];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${tot.name}, Tot, ${label}`}
      className="flex-row items-center gap-2.5 border-b border-separator bg-screen px-4"
      style={{ height: TOT_THREAD_HEADER_HEIGHT }}
    >
      <View
        style={{
          padding: FACE_RING,
          borderRadius: 12,
          borderWidth: FACE_RING,
          borderColor: `${tot.avatar.color}73`,
        }}
      >
        <TotLiveFace avatar={tot.avatar} state={state} size={FACE_SIZE} animate={props.animate} />
      </View>
      <AppText numberOfLines={1} className="shrink font-t3-bold text-sm text-foreground">
        {tot.name}
      </AppText>
      <View className="rounded-full bg-grouped-card px-1.5 py-0.5">
        <AppText className="text-3xs font-t3-bold tracking-[0.5px] uppercase text-foreground-muted">
          Tot
        </AppText>
      </View>
      <View className="flex-1" />
      <AppText numberOfLines={1} className="shrink text-xs text-foreground-muted">
        {label}
      </AppText>
    </View>
  );
}
