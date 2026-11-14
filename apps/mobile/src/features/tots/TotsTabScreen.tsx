import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import type { TotFaceState } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useThreadShell } from "../../state/entities";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAnimateTotAvatars, useTots } from "../../state/tots";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { TotLiveFace } from "./TotLiveFace";
import { TotStillFace } from "./TotStillFace";

const NO_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null).pipe(
  Atom.withLabel("mobile-tots-no-host"),
);

const STATE_LABELS: Record<TotFaceState, string> = {
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
  success: "Done",
  failure: "Failed",
  sleep: "Off",
};

function useTotFace(entry: EnvironmentTot) {
  const ref =
    entry.tot.threadId === null ? null : scopeThreadRef(entry.environmentId, entry.tot.threadId);
  const shell = useThreadShell(ref);
  return totFaceState(totFaceInputFromShell(entry.tot, shell));
}

function TotListRow(props: { readonly entry: EnvironmentTot }) {
  const { environmentId, tot } = props.entry;
  const state = useTotFace(props.entry);
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const open = () => {
    if (tot.threadId === null) {
      navigation.navigate("TotEditor", { environmentId, totId: tot.id });
      return;
    }
    selectDetail({ name: "Thread", params: { environmentId, threadId: tot.threadId } });
  };
  return (
    <ListRow
      leading={<TotStillFace avatar={tot.avatar} state={state} size={30} />}
      label={tot.name}
      description={STATE_LABELS[state]}
      onPress={open}
    />
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

/** The Tots tab: each Tot's face and state; the first one moves. */
export function TotsTabScreen() {
  const insets = useSafeAreaInsets();
  const tots = useTots();
  const navigation = useNavigation();
  const connected = useAtomValue(connectedEnvironmentIdsAtom);
  const hostEnvironmentId = tots[0]?.environmentId ?? connected[0] ?? null;
  const hero = tots.find((entry) => entry.tot.threadId !== null);
  // Every Tot on the host, a Home never turned on included, so each can be managed here.
  const hostSettings = useAtomValue(
    hostEnvironmentId === null
      ? NO_SETTINGS_ATOM
      : serverEnvironment.settingsValueAtom(hostEnvironmentId),
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      {hero === undefined ? null : <TotHero entry={hero} />}
      <ListSection
        title="Tots"
        footer="A Tot is an agent you talk to in one thread. It starts, watches and answers the threads in its scope for you."
      >
        {tots.map((entry) => (
          <TotListRow key={`${entry.environmentId}:${entry.tot.id}`} entry={entry} />
        ))}
        {hostEnvironmentId === null ? null : (
          <ListActionRow
            icon="plus"
            label="New Tot"
            onPress={() => navigation.navigate("TotEditor", { environmentId: hostEnvironmentId })}
          />
        )}
      </ListSection>
      {hostEnvironmentId === null || hostSettings === null ? null : (
        <ListSection title="Manage">
          {hostSettings.tots.map((tot) => (
            <ListActionRow
              key={tot.id}
              icon="slider.horizontal.3"
              label={tot.threadId === null ? `Turn on or edit ${tot.name}` : `Edit ${tot.name}`}
              onPress={() =>
                navigation.navigate("TotEditor", {
                  environmentId: hostEnvironmentId,
                  totId: tot.id,
                })
              }
            />
          ))}
        </ListSection>
      )}
    </ScrollView>
  );
}
