import {
  TOT_FACE_STATE_LABELS as STATE_LABELS,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import { useAtomValue } from "@effect/atom-react";
import { HOME_TOT_ID, type ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { serverEnvironment } from "../../state/server";
import {
  useAnimateTotAvatars,
  useTotFace,
  useTotHosts,
  useTots,
  type TotHost,
} from "../../state/tots";
import { useWorkspaceSettledContentWidth } from "../layout/workspace-content-width";
import { useWorkspaceListBottomInset } from "../layout/workspace/workspace-list-insets";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { TotLiveFace } from "./TotLiveFace";
import { TotStillFace } from "./TotStillFace";

const NO_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null).pipe(
  Atom.withLabel("mobile-tots-no-host"),
);

/** Big enough to read a Tot's face and its mood, which a list of people rows wants. */
const TOT_LIST_FACE_SIZE = 40;

// The unfolded Fold and tablets: hero beside the list, as wide as a desktop settings column.
const WIDE_LAYOUT_MIN_WIDTH = 600;

/** Opens the Tot's thread, or its editor while it is off, like the desktop sidebar row. */
function TotListRow(props: { readonly entry: EnvironmentTot; readonly machine: string | null }) {
  const { environmentId, tot } = props.entry;
  const state = useTotFace(props.entry);
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const edit = () => navigation.navigate("TotEditor", { environmentId, totId: tot.id });
  const open = () => {
    if (tot.threadId === null) {
      edit();
      return;
    }
    selectDetail({ name: "Thread", params: { environmentId, threadId: tot.threadId } });
  };
  const description =
    props.machine === null ? STATE_LABELS[state] : `${STATE_LABELS[state]} · ${props.machine}`;
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={`${tot.name}, ${description}`}
      onPress={open}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className="bg-grouped-card"
    >
      <ListRowLayout
        leading={<TotStillFace avatar={tot.avatar} state={state} size={TOT_LIST_FACE_SIZE} />}
        leadingSize={TOT_LIST_FACE_SIZE}
        label={tot.name}
        description={description}
        accessory={
          <IconButton
            icon="slider.horizontal.3"
            accessibilityLabel={`Edit ${tot.name}`}
            onPress={edit}
          />
        }
      />
    </RowPressable>
  );
}

function TotHero(props: { readonly entry: EnvironmentTot }) {
  const state = useTotFace(props.entry);
  const animate = useAnimateTotAvatars();
  return (
    <View className="items-center gap-2 py-4">
      <TotLiveFace avatar={props.entry.tot.avatar} state={state} size={112} animate={animate} />
      <AppText className="font-t3-bold text-lg">{props.entry.tot.name}</AppText>
      <AppText className="text-sm text-foreground-muted">{STATE_LABELS[state]}</AppText>
    </View>
  );
}

function machineLabel(hosts: ReadonlyArray<TotHost>, entry: EnvironmentTot): string | null {
  if (hosts.length < 2) return null;
  return hosts.find((host) => host.environmentId === entry.environmentId)?.label ?? null;
}

/** The Tots tab: every Tot on every machine, then a way to make one. */
export function TotsTabScreen() {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const bottomInset = useWorkspaceListBottomInset({ automaticBottomInset: true });
  // A workspace pane knows its width in the render that resizes it; measuring lags a frame.
  const width = useWorkspaceSettledContentWidth() ?? measuredWidth;
  const tots = useTots();
  const hosts = useTotHosts();
  const navigation = useNavigation();
  const host = hosts[0]?.environmentId ?? null;
  const hostSettings = useAtomValue(
    host === null ? NO_SETTINGS_ATOM : serverEnvironment.settingsValueAtom(host),
  );
  // Lists skip a Home never turned on; show the default machine's so it can be turned on here.
  const offHome =
    host === null || tots.some((entry) => entry.tot.id === HOME_TOT_ID)
      ? null
      : (hostSettings?.tots.find((tot) => tot.id === HOME_TOT_ID) ?? null);
  const rows: ReadonlyArray<EnvironmentTot> =
    offHome === null || host === null ? tots : [{ environmentId: host, tot: offHome }, ...tots];
  const hero = tots.find((entry) => entry.tot.threadId !== null);
  const wide = width >= WIDE_LAYOUT_MIN_WIDTH;

  const list = (
    <View className="gap-6" style={wide ? { flex: 1, maxWidth: 560 } : undefined}>
      <ListSection footer="A Tot is an agent you talk to in one thread. It starts, watches and answers the threads in its scope for you.">
        {rows.map((entry) => (
          <TotListRow
            key={`${entry.environmentId}:${entry.tot.id}`}
            entry={entry}
            machine={machineLabel(hosts, entry)}
          />
        ))}
        {host === null ? null : (
          <ListActionRow
            icon="plus"
            label="New Tot"
            onPress={() => navigation.navigate("TotEditor", { environmentId: host })}
          />
        )}
      </ListSection>
      {hostSettings === null || hostSettings.linkedEnvironmentsEnabled ? null : (
        <AppText className="px-1 text-sm text-foreground-muted">
          Turn on Linked environments in Labs, on each machine, so Tots can reach your other
          machines.
        </AppText>
      )}
    </View>
  );

  return (
    <SettingsScreen title="Tots" workspaceRoot>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: bottomInset }}
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      >
        {wide ? (
          <View className="flex-row items-start justify-center gap-8">
            {hero === undefined ? null : (
              <View className="w-56 pt-2">
                <TotHero entry={hero} />
              </View>
            )}
            {list}
          </View>
        ) : (
          <View className="gap-6">
            {hero === undefined ? null : <TotHero entry={hero} />}
            {list}
          </View>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
