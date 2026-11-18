import { TOT_FACE_STATE_LABELS, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { TotThemeTokens } from "@t3tools/shared/totThemeTokens";
import { Platform, View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { useTotFace } from "../../state/tots";
import { TotLiveFace } from "./TotLiveFace";
import { TotStatePill } from "./TotStatePill";

const FACE_RING = 6;

/** How tall the pinned identity band is, so the feed can clear it. */
export const TOT_THREAD_HEADER_HEIGHT = 64;
const FACE_SIZE = 42;

/**
 * The Tot you are talking to: its face, its name, what it is doing. It sits under the navigation
 * bar on the Tot's own wash, so the thread header keeps the title and this keeps the identity.
 */
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
  const accent = tot.avatar.color;
  const bandBackground = tokens["--tot-bg"];
  const textColor = tokens["--tot-text"];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${tot.name}, Tot, ${label}`}
      className={cn(
        "border-b border-separator",
        Platform.OS === "android" ? "bg-thread-canvas" : "bg-screen",
      )}
      style={{
        height: TOT_THREAD_HEADER_HEIGHT,
        ...(tokens["--tot-border"] === undefined
          ? null
          : { borderBottomColor: tokens["--tot-border"] }),
      }}
    >
      {/* The feed scrolls under this band, so a theme's translucent --tot-bg and the accent wash
          both sit over the opaque canvas colour instead of replacing it. */}
      {bandBackground === undefined ? null : (
        <View
          pointerEvents="none"
          className="absolute inset-0"
          style={{ backgroundColor: bandBackground }}
        />
      )}
      <View
        pointerEvents="none"
        className="absolute inset-0"
        style={{ backgroundColor: `${accent}14` }}
      />
      <View className="flex-1 flex-row items-center gap-3 px-4">
        <View
          className="items-center justify-center"
          style={{
            padding: FACE_RING,
            borderRadius: 32,
            backgroundColor: `${accent}21`,
          }}
        >
          <TotLiveFace avatar={tot.avatar} state={state} size={FACE_SIZE} animate={props.animate} />
        </View>
        <View className="min-w-0 flex-1 justify-center gap-1">
          <AppText
            numberOfLines={1}
            className="font-t3-semibold text-lg text-foreground"
            style={textColor === undefined ? undefined : { color: textColor }}
          >
            {tot.name}
          </AppText>
          <View className="flex-row">
            <TotStatePill size="band" state={state} accent={accent} />
          </View>
        </View>
      </View>
    </View>
  );
}
