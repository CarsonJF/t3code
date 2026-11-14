import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isTotProject } from "@t3tools/client-runtime/tots";
import { validateTotDraft, type TotDraftErrors } from "@t3tools/client-runtime/tots/editor";
import { TOT_SKIN_SERIES, totSkinSeriesOf, totSkinsIn } from "@t3tools/client-runtime/tots/skins";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  TOT_SHAPES,
  type ProjectId,
  type TotAvatar as TotAvatarValue,
  type TotScope,
  type TotShape,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { useProjects } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useTots } from "~/state/tots";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
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
import { closeTotEditor, type TotEditorTarget, useTotEditorTarget } from "./totEditorStore";
import { useTotModelChoice } from "./useTotModelChoice";

const COLOR_CHOICES = ["#0A7EA4", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#475569"];

const faceOf = (color: string, skin: number | null, shape: TotShape): TotAvatarValue => ({
  color,
  ...(skin === null ? {} : { skin }),
  ...(shape === "round" ? {} : { shape }),
});

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
  const { environmentId } = target;
  const editing = target.mode === "edit" ? target.tot : null;
  const navigate = useNavigate();
  const tots = useTots();
  const projects = useProjects();
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const model = useTotModelChoice(environmentId, editing?.modelSelection ?? null);
  const createTot = useAtomCommand(serverEnvironment.createTot, { reportFailure: false });
  const updateTot = useAtomCommand(serverEnvironment.updateTot, { reportFailure: false });
  const enableTot = useAtomCommand(serverEnvironment.enableTot, { reportFailure: false });

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.avatar.color ?? COLOR_CHOICES[0]!);
  const [skin, setSkin] = useState<number | null>(editing?.avatar.skin ?? null);
  const [shape, setShape] = useState<TotShape>(editing?.avatar.shape ?? "round");
  const [skinSeries, setSkinSeries] = useState(() => totSkinSeriesOf(skin));
  const [scope, setScope] = useState<TotScope>(editing?.scope ?? "all");
  const [instructions, setInstructions] = useState(editing?.instructions ?? "");
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

  const submit = async () => {
    if (model.selection === null) {
      setFailure("Turn on a provider first.");
      return;
    }
    const checked = validateTotDraft(
      { name, color, skin, shape, scope, instructions, modelSelection: model.selection },
      environmentTots.map((tot) => tot.id),
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
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setFailure(String(squashAtomCommandFailure(result)));
        }
        return;
      }
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
            <DialogTitle>{editing === null ? "New Tot" : `Edit ${editing.name}`}</DialogTitle>
            <DialogDescription>
              A Tot is an agent you talk to in one thread. It starts, watches and answers the
              threads in its scope for you.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <TotAvatar
                  avatar={faceOf(color, skin, shape)}
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

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 font-medium text-sm">Face</legend>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLOR_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-label={`Color ${choice}`}
                      aria-pressed={color === choice}
                      className="size-6 rounded-full border border-border aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-ring"
                      style={{ backgroundColor: choice }}
                      onClick={() => setColor(choice)}
                    />
                  ))}
                  <Input
                    aria-label="Color"
                    className="w-24"
                    value={color}
                    aria-invalid={errors.color !== undefined}
                    onChange={(event) => setColor(event.target.value)}
                  />
                </div>
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  aria-label="Shape"
                  role="group"
                >
                  {TOT_SHAPES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-label={`Shape ${choice}`}
                      aria-pressed={shape === choice}
                      className="rounded-md border border-transparent p-0.5 aria-pressed:border-ring"
                      onClick={() => setShape(choice)}
                    >
                      <TotAvatar
                        avatar={faceOf(color, skin, choice)}
                        state="idle"
                        animation="still"
                        size={28}
                      />
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs">Skin</span>
                  <Select
                    value={String(skinSeries.series)}
                    onValueChange={(value) =>
                      setSkinSeries(
                        TOT_SKIN_SERIES.find((series) => String(series.series) === value) ??
                          skinSeries,
                      )
                    }
                  >
                    <SelectTrigger size="sm" className="w-48" aria-label="Skin series">
                      <SelectValue>{skinSeries.title}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {TOT_SKIN_SERIES.map((series) => (
                        <SelectItem key={series.series} value={String(series.series)}>
                          {series.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[null, ...totSkinsIn(skinSeries)].map((choice) => (
                    <button
                      key={choice ?? "flat"}
                      type="button"
                      aria-label={choice === null ? "No skin" : `Skin ${choice}`}
                      aria-pressed={skin === choice}
                      className="rounded-md border border-transparent p-0.5 aria-pressed:border-ring"
                      onClick={() => setSkin(choice)}
                    >
                      <TotAvatar
                        avatar={faceOf(color, choice, shape)}
                        state="idle"
                        animation="still"
                        size={28}
                      />
                    </button>
                  ))}
                </div>
                {errors.color ? (
                  <p className="text-destructive-foreground text-xs">{errors.color}</p>
                ) : null}
              </fieldset>

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

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tot-instructions">Personality and instructions</Label>
                <Textarea
                  id="tot-instructions"
                  value={instructions}
                  placeholder="Warm and brief. Owns everything Cardinal Systems."
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>

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

              {failure ? <p className="text-destructive-foreground text-sm">{failure}</p> : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeTotEditor}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {editing === null ? (pending ? "Creating…" : "Create and start") : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
