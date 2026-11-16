import { TOT_FACE_STATE_LABELS, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { TotThemeTokens } from "@t3tools/shared/totThemeTokens";
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
  /** The open thread's colour tokens; every surface keeps the app's colours without them. */
  readonly tokens: TotThemeTokens;
}) {
  const { tot } = props.entry;
  const state = useTotFace(props.entry);
  const label = TOT_FACE_STATE_LABELS[state];
  const tokens = props.tokens;
  const bandBackground = tokens["--tot-bg"];
  const bandBorder = tokens["--tot-border"];
  const textColor = tokens["--tot-text"];
  const mutedColor = tokens["--tot-muted"];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${tot.name}, Tot, ${label}`}
      className="flex-row items-center gap-2.5 border-b border-separator bg-screen px-4"
      style={{
        height: TOT_THREAD_HEADER_HEIGHT,
        ...(bandBackground === undefined ? null : { backgroundColor: bandBackground }),
        ...(bandBorder === undefined ? null : { borderBottomColor: bandBorder }),
      }}
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
      <AppText
        numberOfLines={1}
        className="shrink font-t3-bold text-sm text-foreground"
        style={textColor === undefined ? undefined : { color: textColor }}
      >
        {tot.name}
      </AppText>
      <View className="flex-1" />
      <AppText
        numberOfLines={1}
        className="shrink text-xs text-foreground-muted"
        style={mutedColor === undefined ? undefined : { color: mutedColor }}
      >
        {label}
      </AppText>
    </View>
  );
}
