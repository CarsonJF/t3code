import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isTotProject } from "@t3tools/client-runtime/tots";
import { validateTotDraft, type TotDraftErrors } from "@t3tools/client-runtime/tots/editor";
import {
  EnvironmentId,
  HOME_TOT_ID,
  type ModelSelection,
  type ProjectId,
  type Tot,
  type TotId,
  type TotScope,
} from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { TotStillFace } from "./TotStillFace";

const COLOR_CHOICES = ["#0A7EA4", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#475569"];

type TotEditorRouteParams = { readonly environmentId: string; readonly totId?: string };

/** Creates or edits a Tot on one environment, as the desktop editor does. */
export function TotEditorRouteScreen({ route }: StaticScreenProps<TotEditorRouteParams>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const editing = settings?.tots.find((tot) => tot.id === route.params.totId) ?? null;
  return (
    <SettingsScreen title={editing === null ? "New Tot" : editing.name}>
      {settings === null ? null : (
        <TotEditorForm
          key={editing?.id ?? "new"}
          environmentId={environmentId}
          tots={settings.tots}
          editingId={editing?.id ?? null}
          defaultModel={
            editing?.modelSelection ??
            settings.defaultModelSelection ??
            firstProviderModel(providers ?? [])
          }
        />
      )}
    </SettingsScreen>
  );
}

function firstProviderModel(
  providers: ReadonlyArray<{
    readonly instanceId: ModelSelection["instanceId"];
    readonly status: string;
    readonly models: ReadonlyArray<{ readonly slug: string }>;
  }>,
): ModelSelection | null {
  const provider = providers.find((entry) => entry.status === "ready" && entry.models.length > 0);
  return provider === undefined
    ? null
    : { instanceId: provider.instanceId, model: provider.models[0]!.slug };
}

function TotEditorForm(props: {
  readonly environmentId: EnvironmentId;
  readonly tots: ReadonlyArray<Tot>;
  readonly editingId: TotId | null;
  readonly defaultModel: ModelSelection | null;
}) {
  const { environmentId, tots, editingId, defaultModel } = props;
  const editing = tots.find((tot) => tot.id === editingId) ?? null;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const projects = useProjects();
  const createTot = useAtomCommand(serverEnvironment.createTot, { reportFailure: false });
  const updateTot = useAtomCommand(serverEnvironment.updateTot, { reportFailure: false });
  const enableTot = useAtomCommand(serverEnvironment.enableTot, { reportFailure: false });
  const disableTot = useAtomCommand(serverEnvironment.disableTot, { reportFailure: false });
  const startFreshTot = useAtomCommand(serverEnvironment.startFreshTot, { reportFailure: false });
  const removeTot = useAtomCommand(serverEnvironment.removeTot, { reportFailure: false });

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.avatar.color ?? COLOR_CHOICES[0]!);
  const [scope, setScope] = useState<TotScope>(editing?.scope ?? "all");
  const [instructions, setInstructions] = useState(editing?.instructions ?? "");
  const [errors, setErrors] = useState<TotDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const scopeProjects = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      project.isScratch !== true &&
      !isTotProject(project.id, tots),
  );
  const selected = new Set(scope === "all" ? [] : scope.projects.map((entry) => entry.projectId));
  const toggleProject = (projectId: ProjectId) => {
    const current = scope === "all" ? [] : scope.projects;
    const next = selected.has(projectId)
      ? current.filter((entry) => entry.projectId !== projectId)
      : [...current, { environmentId, projectId }];
    setScope({ projects: next, groups: scope === "all" ? [] : scope.groups });
  };

  const openThread = (threadId: string) =>
    selectDetail({ name: "Thread", params: { environmentId, threadId } });

  const report = (result: { readonly _tag: "Failure" }) => {
    if (!isAtomCommandInterrupted(result as never)) {
      setFailure(String(squashAtomCommandFailure(result as never)));
    }
  };

  const save = async () => {
    const model = editing?.modelSelection ?? defaultModel;
    if (model === null) {
      setFailure("Turn on a provider first.");
      return;
    }
    const checked = validateTotDraft(
      {
        name,
        color,
        skin: editing?.avatar.skin ?? null,
        scope,
        instructions,
        modelSelection: model,
      },
      tots.map((tot) => tot.id),
      editing?.id ?? null,
    );
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setPending(true);
    if (editing !== null) {
      const result = await updateTot({
        environmentId,
        input: { id: editing.id, ...checked.value },
      });
      setPending(false);
      if (result._tag === "Failure") return report(result);
      navigation.goBack();
      return;
    }
    const created = await createTot({ environmentId, input: checked.value });
    if (created._tag === "Failure") {
      setPending(false);
      return report(created);
    }
    const enabled = await enableTot({
      environmentId,
      input: { id: created.value.id, modelSelection: model },
    });
    setPending(false);
    if (enabled._tag === "Failure") return report(enabled);
    openThread(enabled.value.threadId);
  };

  const act = async (
    run: () => Promise<{ readonly _tag: "Success" | "Failure"; readonly value?: unknown }>,
  ) => {
    setPending(true);
    const result = await run();
    setPending(false);
    if (result._tag === "Failure") report(result as { readonly _tag: "Failure" });
    return result;
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <View className="items-center gap-3">
        <TotStillFace avatar={{ color }} state="idle" size={88} />
        <View className="flex-row gap-2">
          {COLOR_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              accessibilityRole="button"
              accessibilityLabel={`Color ${choice}`}
              accessibilityState={{ selected: color === choice }}
              onPress={() => setColor(choice)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: choice,
                borderWidth: color === choice ? 3 : 0,
                borderColor: "#F8FAFC",
              }}
            />
          ))}
        </View>
      </View>

      <ListSection title="Name" {...(errors.name ? { footer: errors.name } : {})}>
        <AppTextInput
          className="px-4 py-3 text-base"
          value={name}
          placeholder="Yui"
          onChangeText={setName}
          accessibilityLabel="Name"
        />
      </ListSection>

      <ListSection title="Scope" {...(errors.scope ? { footer: errors.scope } : {})}>
        <ListRow
          label="Everything"
          description="Every project on every machine"
          selected={scope === "all"}
          onPress={() => setScope(scope === "all" ? { projects: [], groups: [] } : "all")}
        />
        {scope === "all"
          ? null
          : scopeProjects.map((project) => (
              <ListRow
                key={project.id}
                label={project.title}
                selected={selected.has(project.id)}
                onPress={() => toggleProject(project.id)}
              />
            ))}
      </ListSection>

      <ListSection title="Personality and instructions">
        <AppTextInput
          className="min-h-28 px-4 py-3 text-base"
          multiline
          value={instructions}
          placeholder="Warm and brief. Owns everything Cardinal Systems."
          onChangeText={setInstructions}
          accessibilityLabel="Personality and instructions"
        />
      </ListSection>

      {failure === null ? null : <AppText className="text-sm text-destructive">{failure}</AppText>}

      <ListSection>
        <ListActionRow
          icon="checkmark"
          label={editing === null ? "Create and start" : "Save"}
          loading={pending}
          onPress={() => void save()}
        />
        {editing === null ? null : editing.threadId === null ? (
          <ListActionRow
            icon="play"
            label="Turn on"
            onPress={() =>
              void act(() =>
                enableTot({
                  environmentId,
                  input: {
                    id: editing.id,
                    ...(defaultModel === null ? {} : { modelSelection: defaultModel }),
                  },
                }),
              )
            }
          />
        ) : (
          <>
            <ListActionRow
              icon="arrow.clockwise"
              label="Start fresh"
              onPress={() =>
                void act(() => startFreshTot({ environmentId, input: { id: editing.id } }))
              }
            />
            <ListActionRow
              icon="pause"
              label="Turn off"
              onPress={() =>
                void act(() => disableTot({ environmentId, input: { id: editing.id } }))
              }
            />
          </>
        )}
        {editing === null || editing.id === HOME_TOT_ID ? null : (
          <ListActionRow
            icon="trash"
            label="Delete"
            tone="danger"
            onPress={() =>
              void act(() => removeTot({ environmentId, input: { id: editing.id } })).then(
                (result) => {
                  if (result._tag === "Success") navigation.goBack();
                },
              )
            }
          />
        )}
      </ListSection>
    </ScrollView>
  );
}
