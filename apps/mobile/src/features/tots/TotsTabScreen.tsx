import type { EnvironmentTot } from "@t3tools/client-runtime/tots";
import { useAtomValue } from "@effect/atom-react";
import { HOME_TOT_ID, type ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, Platform, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { SymbolView } from "../../components/ui/AppSymbol";
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
import { TOT_CARD_MIN_HEIGHT, TotCard } from "./TotCard";
import {
  TOT_GRID_GAP,
  TOT_GRID_MAX_WIDTH,
  totCardWidth,
  totGridColumns,
  totGridRows,
} from "./totGrid";

const NO_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null).pipe(
  Atom.withLabel("mobile-tots-no-host"),
);

/** Opens the Tot's thread, or its editor while it is off, like the desktop sidebar row. */
function TotGridCard(props: {
  readonly entry: EnvironmentTot;
  readonly machine: string | null;
  readonly width: number;
}) {
  const { environmentId, tot } = props.entry;
  const state = useTotFace(props.entry);
  const animate = useAnimateTotAvatars();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const edit = () => navigation.navigate("TotEditor", { environmentId, totId: tot.id });
  const open = () => {
    if (tot.threadId === null) {
      edit();
      return;
    }
    selectDetail({ name: "Thread", params: { environmentId, threadId: tot.threadId } });
  };
  return (
    <TotCard
      entry={props.entry}
      state={state}
      machine={props.machine}
      width={props.width}
      animate={animate}
      onOpen={open}
      onEdit={edit}
    />
  );
}

/** The grid's last cell: the same card shape, so making a Tot reads as one more face. */
function NewTotCard(props: { readonly width: number; readonly onPress: () => void }) {
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New Tot"
      onPress={props.onPress}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className="items-center justify-center gap-2.5 overflow-hidden rounded-3xl border border-border bg-card"
      style={{ width: props.width, minHeight: TOT_CARD_MIN_HEIGHT }}
    >
      <View className="size-12 items-center justify-center rounded-full bg-subtle">
        <SymbolView
          name="plus"
          size={22}
          tintColorClassName="accent-foreground"
          type="monochrome"
        />
      </View>
      <AppText className="font-t3-medium text-foreground">New Tot</AppText>
    </Pressable>
  );
}

function machineLabel(hosts: ReadonlyArray<TotHost>, entry: EnvironmentTot): string | null {
  if (hosts.length < 2) return null;
  return hosts.find((host) => host.environmentId === entry.environmentId)?.label ?? null;
}

/** The Tots tab: every Tot on every machine as a face, then a way to make one. */
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

  // The page's own settled width, not the scroll content's: Android caps that content at 720dp, and
  // a card row wide enough to fill the cap would keep a fold-narrowed page at the wide layout.
  const available = Math.max(0, Math.min(width - 40, TOT_GRID_MAX_WIDTH));
  const columns = totGridColumns(available);
  const cardWidth = totCardWidth(available, columns);
  const newTot =
    host === null ? undefined : () => navigation.navigate("TotEditor", { environmentId: host });
  const cells = [
    ...rows.map((entry) => (
      <TotGridCard
        key={`${entry.environmentId}:${entry.tot.id}`}
        entry={entry}
        machine={machineLabel(hosts, entry)}
        width={cardWidth}
      />
    )),
    ...(newTot === undefined
      ? []
      : [<NewTotCard key="new-tot" width={cardWidth} onPress={newTot} />]),
  ];

  return (
    <SettingsScreen title="Tots" workspaceRoot>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-5"
        contentContainerStyle={{ paddingBottom: bottomInset }}
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      >
        {rows.length === 0 ? (
          <EmptyState
            variant="plain"
            title="No Tots yet"
            detail="A Tot is an agent you talk to in one thread. It starts, watches and answers the threads in its scope for you."
            {...(newTot === undefined ? {} : { actionLabel: "New Tot", onAction: newTot })}
          />
        ) : (
          <View className="gap-3">
            {totGridRows(cells, columns).map((row) => (
              <View key={row[0]?.key} className="flex-row" style={{ gap: TOT_GRID_GAP }}>
                {row}
              </View>
            ))}
          </View>
        )}
        {rows.length === 0 ? null : (
          <AppText className="mt-4 px-1 text-sm text-foreground-muted">
            A Tot is an agent you talk to in one thread. It starts, watches and answers the threads
            in its scope for you.
          </AppText>
        )}
        {hostSettings === null || hostSettings.linkedEnvironmentsEnabled ? null : (
          <AppText className="mt-3 px-1 text-sm text-foreground-muted">
            Turn on Linked environments in Labs, on each machine, so Tots can reach your other
            machines.
          </AppText>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
