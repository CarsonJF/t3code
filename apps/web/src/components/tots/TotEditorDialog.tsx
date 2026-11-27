import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isTotProject } from "@t3tools/client-runtime/tots";
import {
  applyTotTemplate,
  validateTotDraft,
  type TotDraftErrors,
} from "@t3tools/client-runtime/tots/editor";
import { totSkinSeriesOf } from "@t3tools/client-runtime/tots/skins";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  HOME_TOT_ID,
  type EnvironmentId,
  type ProjectId,
  type TotAccessory,
  type TotAvatar as TotAvatarValue,
  type TotScope,
  type TotShape,
  type TotTemplate,
} from "@t3tools/contracts";
import { findTotTemplate, TOT_TEMPLATES } from "@t3tools/shared/totTemplates";
import { T, useGT } from "gt-react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useScopedThemes } from "~/hooks/useScopedThemes";
import { scopedThemeKey } from "~/scopedThemes.logic";
import { useClientSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { useProjects } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useTotHosts, useTots } from "~/state/tots";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { AvatarLibraryDialog } from "../settings/AvatarLibrarySettings";
import { ScopedThemeSelect } from "../settings/ScopedThemeSelect";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { TotAvatar } from "./TotAvatar";
import { useAvatarLibrarySync } from "./useAvatarLibrarySync";
import { TotFaceEditor, totFaceLookOf, totFaceOf, TOT_FACE_COLORS } from "./TotFaceEditor";
import { closeTotEditor, type TotEditorTarget, useTotEditorTarget } from "./totEditorStore";
import { useTotModelChoice } from "./useTotModelChoice";

/** Mounted once; opens for whatever asked for it. */
export function TotEditorHost() {
  const target = useTotEditorTarget();
  if (target === null) return null;
  const key =
    target.mode === "edit" ? `${target.environmentId}:${target.tot.id}` : target.environmentId;
  return <TotEditorDialog key={key} target={target} />;
}

function TotEditorDialog(props: { readonly target: TotEditorTarget }) {
  const { target } = props;
  const editing = target.mode === "edit" ? target.tot : null;
  const [chosenHost, setChosenHost] = useState(target.environmentId);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const environmentId = chosenHost;
  const moving = editing !== null && chosenHost !== target.environmentId;
  const hosts = useTotHosts();
  const navigate = useNavigate();
  const tots = useTots();
  useAvatarLibrarySync([environmentId], editing?.id ?? "new");
  const projects = useProjects();
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const model = useTotModelChoice(environmentId, editing?.modelSelection ?? null);
  const createTot = useAtomCommand(serverEnvironment.createTot, { reportFailure: false });
  const updateTot = useAtomCommand(serverEnvironment.updateTot, { reportFailure: false });
  const enableTot = useAtomCommand(serverEnvironment.enableTot, { reportFailure: false });
  const removeTot = useAtomCommand(serverEnvironment.removeTot, { reportFailure: false });
  const scopedThemes = useScopedThemes();
  const [themeId, setThemeId] = useState<string | null>(
    editing === null
      ? null
      : (scopedThemes.scoped.tots[scopedThemeKey(target.environmentId, editing.id)] ?? null),
  );
  const applyFace = (face: TotAvatarValue) => {
    setColor(face.color);
    setSkin(face.skin ?? null);
    setSkinSeries(totSkinSeriesOf(face.skin ?? null));
    setShape(face.shape ?? "round");
    setAntenna(face.antenna === true);
    setAccessories(face.accessories ?? []);
    setLook(totFaceLookOf(face));
  };
  const readTotMemory = useAtomCommand(serverEnvironment.readTotMemory, { reportFailure: false });
  const writeTotMemory = useAtomCommand(serverEnvironment.writeTotMemory, { reportFailure: false });

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.avatar.color ?? TOT_FACE_COLORS[0]!);
  const [skin, setSkin] = useState<number | null>(editing?.avatar.skin ?? null);
  const [shape, setShape] = useState<TotShape>(editing?.avatar.shape ?? "round");
  const [antenna, setAntenna] = useState(editing?.avatar.antenna === true);
  const [accessories, setAccessories] = useState<ReadonlyArray<TotAccessory>>(
    editing?.avatar.accessories ?? [],
  );
  const [look, setLook] = useState(() => totFaceLookOf(editing?.avatar));
  const [skinSeries, setSkinSeries] = useState(() => totSkinSeriesOf(skin));
  const [scope, setScope] = useState<TotScope>(editing?.scope ?? "all");
  const [instructions, setInstructions] = useState(editing?.instructions ?? "");
  const [template, setTemplate] = useState<TotTemplate | undefined>(undefined);
  const gt = useGT();
  const pickTemplate = (id: string) => {
    const next = findTotTemplate(id);
    if (next === undefined) return;
    const filled = applyTotTemplate(
      { name, instructions, scope, template: template?.id },
      next,
      template,
    );
    setName(filled.name);
    setInstructions(filled.instructions);
    setScope(filled.scope);
    setTemplate(next);
    applyFace(next.avatar);
  };
  const [errors, setErrors] = useState<TotDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const environmentTots = tots
    .filter((entry) => entry.environmentId === environmentId)
    .map((entry) => entry.tot);
  const scopeProjects = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      project.isScratch !== true &&
      !isTotProject(project.id, environmentTots),
  );
  const selectedProjectIds = new Set(
    scope === "all" ? [] : scope.projects.map((entry) => entry.projectId),
  );
  const toggleProject = (projectId: ProjectId, on: boolean) => {
    const current = scope === "all" ? [] : scope.projects;
    const next = on
      ? [...current, { environmentId, projectId }]
      : current.filter((entry) => entry.projectId !== projectId);
    setScope({ projects: next, groups: scope === "all" ? [] : scope.groups });
  };
  // Picked projects and models belong to the old machine, so a move starts them over.
  const moveTo = (host: EnvironmentId) => {
    if (host === environmentId) return;
    setScope((current) => (current === "all" ? "all" : { projects: [], groups: [] }));
    model.reset();
    setChosenHost(host);
  };

  const submit = async () => {
    if (model.selection === null) {
      setFailure("Turn on a provider first.");
      return;
    }
    const checked = validateTotDraft(
      {
        name,
        color,
        skin,
        shape,
        antenna,
        accessories,
        ...look,
        scope,
        instructions,
        modelSelection: model.selection,
        ...(editing === null
          ? { memoryTidy: true, ...(template === undefined ? {} : { template: template.id }) }
          : moving
            ? { memoryTidy: editing.memoryTidy === true }
            : {}),
      },
      environmentTots.map((tot) => tot.id),
      moving ? null : (editing?.id ?? null),
    );
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setPending(true);
    if (editing !== null && moving) {
      // A Tot lives on one machine, so a move makes it anew on the other, brings its memory
      // along, and removes the original last so a failure leaves it where it was.
      const memory = await readTotMemory({
        environmentId: target.environmentId,
        input: { id: editing.id },
      });
      // Every machine already has a Home of its own, so Home takes its settings there instead.
      const created =
        editing.id === HOME_TOT_ID
          ? await updateTot({ environmentId, input: { id: HOME_TOT_ID, ...checked.value } })
          : await createTot({ environmentId, input: checked.value });
      if (created._tag === "Failure") {
        setPending(false);
        if (!isAtomCommandInterrupted(created)) {
          setFailure(String(squashAtomCommandFailure(created)));
        }
        return;
      }
      if (memory._tag === "Success" && memory.value.files.length > 0) {
        await writeTotMemory({
          environmentId,
          input: { id: created.value.id, files: memory.value.files },
        });
      }
      const enabled =
        editing.threadId === null
          ? null
          : await enableTot({
              environmentId,
              input: { id: created.value.id, modelSelection: checked.value.modelSelection },
            });
      await removeTot({ environmentId: target.environmentId, input: { id: editing.id } });
      scopedThemes.set("tots", target.environmentId, editing.id, null);
      scopedThemes.set("tots", environmentId, created.value.id, themeId);
      setPending(false);
      closeTotEditor();
      if (enabled?._tag === "Success") {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(environmentId, enabled.value.threadId)),
        });
      }
      return;
    }
    if (editing !== null) {
      const result = await updateTot({
        environmentId,
        input: { id: editing.id, ...checked.value },
      });
      setPending(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setFailure(String(squashAtomCommandFailure(result)));
        }
        return;
      }
      scopedThemes.set("tots", environmentId, editing.id, themeId);
      closeTotEditor();
      return;
    }
    const created = await createTot({ environmentId, input: checked.value });
    if (created._tag === "Failure") {
      setPending(false);
      if (!isAtomCommandInterrupted(created)) {
        setFailure(String(squashAtomCommandFailure(created)));
      }
      return;
    }
    scopedThemes.set("tots", environmentId, created.value.id, themeId);
    const enabled = await enableTot({
      environmentId,
      input: { id: created.value.id, modelSelection: checked.value.modelSelection },
    });
    setPending(false);
    closeTotEditor();
    if (enabled._tag === "Success") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, enabled.value.threadId)),
      });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeTotEditor();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing === null ? "New Tot" : `Move ${editing.name}`}</DialogTitle>
            <DialogDescription>
              {editing === null
                ? "A Tot is an agent you talk to in one thread. It starts, watches and answers the threads in its scope for you."
                : "Pick the machine it lives on. Everything else stays in its settings."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {editing === null ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tot-template">
                    <T>Start from</T>
                  </Label>
                  <Select
                    value={template?.id ?? ""}
                    onValueChange={(value) => {
                      if (typeof value === "string") pickTemplate(value);
                    }}
                  >
                    <SelectTrigger size="sm" id="tot-template">
                      <SelectValue>{template?.name ?? gt("Choose a template")}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {TOT_TEMPLATES.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          <span className="flex flex-col">
                            <span>{entry.id === "blank" ? gt("Blank") : entry.name}</span>
                            <span className="text-muted-foreground text-xs">
                              {entry.description}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  {template !== undefined && template.scheduledTasks.length > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {gt(
                        "Adds {count, plural, =1 {a suggested routine} other {{count} suggested routines}}, paused. Turn them on in Settings → Scheduled tasks.",
                        { count: template.scheduledTasks.length },
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {editing === null ? (
                <div className="flex items-center gap-3">
                  <TotAvatar
                    avatar={totFaceOf(color, skin, shape, antenna, accessories, look)}
                    state="idle"
                    animation={animate && !reducedMotion ? "full" : "still"}
                    size={56}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Label htmlFor="tot-name">Name</Label>
                    <Input
                      id="tot-name"
                      value={name}
                      placeholder="Yui"
                      aria-invalid={errors.name !== undefined}
                      onChange={(event) => setName(event.target.value)}
                    />
                    {errors.name ? (
                      <p className="text-destructive-foreground text-xs">{errors.name}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {hosts.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">Lives on</span>
                  <Select
                    value={environmentId}
                    onValueChange={(value) => {
                      const host = hosts.find((entry) => entry.environmentId === value);
                      if (host !== undefined) moveTo(host.environmentId);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-48" aria-label="Lives on">
                      <SelectValue>
                        {hosts.find((host) => host.environmentId === environmentId)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {hosts.map((host) => (
                        <SelectItem key={host.environmentId} value={host.environmentId}>
                          {host.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
              {moving ? (
                <p className="text-muted-foreground text-xs">
                  Moving starts a new thread on the other machine. Its memory comes along; projects
                  in its scope and its model are chosen again there.
                </p>
              ) : null}

              {editing === null ? (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 font-medium text-sm">Face</legend>
                  <TotFaceEditor
                    value={totFaceOf(color, skin, shape, antenna, accessories, look)}
                    onChange={applyFace}
                    skinSeries={skinSeries}
                    onSkinSeriesChange={setSkinSeries}
                    error={errors.color}
                    onManageShapes={() => setLibraryOpen(true)}
                  />
                  <AvatarLibraryDialog
                    environmentId={environmentId}
                    open={libraryOpen}
                    onOpenChange={setLibraryOpen}
                    color={color}
                  />
                </fieldset>
              ) : null}

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 font-medium text-sm">Scope</legend>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={scope === "all"}
                    onCheckedChange={(checked) =>
                      setScope(checked ? "all" : { projects: [], groups: [] })
                    }
                  />
                  Everything, on every machine
                </label>
                {scope === "all" ? null : (
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pl-6">
                    {scopeProjects.map((project) => (
                      <label key={project.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedProjectIds.has(project.id)}
                          onCheckedChange={(checked) => toggleProject(project.id, checked)}
                        />
                        <span className="truncate">{project.title}</span>
                      </label>
                    ))}
                  </div>
                )}
                {errors.scope ? (
                  <p className="text-destructive-foreground text-xs">{errors.scope}</p>
                ) : null}
              </fieldset>

              {editing === null ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tot-instructions">Personality and instructions</Label>
                  <Textarea
                    id="tot-instructions"
                    value={instructions}
                    placeholder="Warm and brief. Owns everything Cardinal Systems."
                    onChange={(event) => setInstructions(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">Model</span>
                {model.selection === null ? (
                  <span className="text-muted-foreground text-sm">No providers available.</span>
                ) : (
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={model.selection.instanceId}
                    model={model.selection.model}
                    lockedProvider={null}
                    instanceEntries={model.entries}
                    modelOptionsByInstance={getCustomModelOptionsByInstance(
                      model.settings,
                      model.providers,
                      model.selection.instanceId,
                      model.selection.model,
                    )}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onInstanceModelChange={model.pick}
                  />
                )}
              </div>

              {editing === null ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">Theme</span>
                  <ScopedThemeSelect
                    label="Theme"
                    value={themeId}
                    inheritLabel="Same as the project"
                    onChange={setThemeId}
                  />
                </div>
              ) : null}

              {failure ? <p className="text-destructive-foreground text-sm">{failure}</p> : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeTotEditor}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (editing !== null && !moving)}>
              {editing === null
                ? pending
                  ? "Creating…"
                  : "Create and start"
                : pending
                  ? "Moving…"
                  : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
