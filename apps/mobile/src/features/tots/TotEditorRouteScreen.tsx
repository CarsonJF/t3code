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
  TOT_SHAPES,
  type ModelSelection,
  type ProjectId,
  type Tot,
  type TotId,
  type TotScope,
  type TotShape,
} from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListSection } from "../../components/ui/ListSection";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SelectionRow } from "../../components/ui/SelectionRow";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useTotHosts, type TotHost } from "../../state/tots";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { TotStillFace } from "./TotStillFace";

const COLOR_CHOICES = ["#0A7EA4", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#475569"];

// The unfolded Fold and tablets: face on the left, the rest on the right.
const WIDE_LAYOUT_MIN_WIDTH = 600;

type TotEditorRouteParams = { readonly environmentId: string; readonly totId?: string };

/** Creates or edits a Tot, as the desktop editor does; a new one can live on any machine. */
export function TotEditorRouteScreen({ route }: StaticScreenProps<TotEditorRouteParams>) {
  const hosts = useTotHosts();
  const [chosenHost, setChosenHost] = useState(() =>
    EnvironmentId.make(route.params.environmentId),
  );
  const creating = route.params.totId === undefined;
  const environmentId = creating ? chosenHost : EnvironmentId.make(route.params.environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const editing = settings?.tots.find((tot) => tot.id === route.params.totId) ?? null;
  return (
    <SettingsScreen title={editing === null ? "New Tot" : editing.name}>
      {settings === null ? null : (
        <TotEditorForm
          key={editing?.id ?? "new"}
          environmentId={environmentId}
          hosts={creating && hosts.length > 1 ? hosts : []}
          onHostChange={setChosenHost}
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
  /** Machines a new Tot may live on; empty when there is no choice to make. */
  readonly hosts: ReadonlyArray<TotHost>;
  readonly onHostChange: (environmentId: EnvironmentId) => void;
  readonly tots: ReadonlyArray<Tot>;
  readonly editingId: TotId | null;
  readonly defaultModel: ModelSelection | null;
}) {
  const { environmentId, tots, editingId, defaultModel } = props;
  const editing = tots.find((tot) => tot.id === editingId) ?? null;
  const insets = useSafeAreaInsets();
  const ringColor = useResolveClassNames("bg-foreground").backgroundColor;
  const [width, setWidth] = useState(0);
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
  const [shape, setShape] = useState<TotShape>(editing?.avatar.shape ?? "round");
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
  // Picked projects belong to the old machine, so a move starts the list over.
  const moveTo = (host: EnvironmentId) => {
    if (host === environmentId) return;
    setScope((current) => (current === "all" ? "all" : { projects: [], groups: [] }));
    props.onHostChange(host);
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
        shape,
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

  // Like the desktop dialog: the face and its name together, then where it lives and what it owns.
  const face = (
    <ListSection title="Face" {...(errors.color ? { footer: errors.color } : {})}>
      <View className="gap-4 px-4 py-4">
        <View className="flex-row items-center gap-4">
          <TotStillFace avatar={{ color, shape }} state="idle" size={72} />
          <View className="min-w-0 flex-1 gap-1">
            <AppText textRole="footnote" className="font-t3-medium text-foreground-muted">
              Name
            </AppText>
            <AppTextInput
              className="rounded-xl bg-subtle px-3 py-2.5 text-base"
              value={name}
              placeholder="Yui"
              onChangeText={setName}
              accessibilityLabel="Name"
            />
            {errors.name ? (
              <AppText className="text-xs text-destructive">{errors.name}</AppText>
            ) : null}
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2.5">
          {COLOR_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              accessibilityRole="button"
              accessibilityLabel={`Color ${choice}`}
              accessibilityState={{ selected: color === choice }}
              onPress={() => setColor(choice)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: choice,
                borderWidth: color === choice ? 3 : 0,
                borderColor: ringColor,
              }}
            />
          ))}
        </View>
        <View className="flex-row flex-wrap gap-1.5">
          {TOT_SHAPES.map((choice) => (
            <Pressable
              key={choice}
              accessibilityRole="button"
              accessibilityLabel={`Shape ${choice}`}
              accessibilityState={{ selected: shape === choice }}
              onPress={() => setShape(choice)}
              style={{
                padding: 3,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: shape === choice ? color : "transparent",
              }}
            >
              <TotStillFace avatar={{ color, shape: choice }} state="idle" size={36} />
            </Pressable>
          ))}
        </View>
      </View>
    </ListSection>
  );

  const details = (
    <>
      {props.hosts.length === 0 ? null : (
        <ListSection
          title="Lives on"
          footer="It reaches your other machines through linked environments."
        >
          {props.hosts.map((host) => (
            <ListChoiceRow
              key={host.environmentId}
              label={host.label}
              selected={host.environmentId === environmentId}
              onPress={() => moveTo(host.environmentId)}
            />
          ))}
        </ListSection>
      )}

      <ListSection title="Scope" {...(errors.scope ? { footer: errors.scope } : {})}>
        <ListToggleRow
          label="Everything"
          description="Every project on every machine"
          value={scope === "all"}
          onValueChange={(all) => setScope(all ? "all" : { projects: [], groups: [] })}
        />
        {scope === "all"
          ? null
          : scopeProjects.map((project) => (
              <SelectionRow
                key={project.id}
                role="checkbox"
                title={project.title}
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
    </>
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      className="flex-1"
      contentContainerClassName="px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width >= WIDE_LAYOUT_MIN_WIDTH ? (
        <View className="flex-row items-start gap-6">
          <View className="flex-1 gap-6">{face}</View>
          <View className="flex-1 gap-6">{details}</View>
        </View>
      ) : (
        <View className="gap-6">
          {face}
          {details}
        </View>
      )}
    </ScrollView>
  );
}
