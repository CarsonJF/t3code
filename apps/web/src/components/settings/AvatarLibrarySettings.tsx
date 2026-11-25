import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  TOT_BUILT_IN_THEMES,
  type AvatarFigure,
  type AvatarLibraryExport,
  type AvatarLibraryKind,
  type AvatarTheme,
  type EnvironmentId,
  type TotAvatar,
  type TotOpenBotMaterial,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";
import { resolveAvatarDesignModelSelection } from "@t3tools/shared/serverSettings";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import type { AvatarDefinition } from "open-bot-avatar";
import { useRef, useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { downloadPlanAsTextFile } from "../../proposedPlan";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { useEnvironmentAvatarLibrary, setAvatarLibrary } from "../tots/avatarLibraryStore";
import { useOpenBotKit } from "../tots/OpenBotFace";
import { StillFigure } from "../tots/StillFigure";
import { TotAvatar as TotFace } from "../tots/TotAvatar";
import { TOT_FACE_COLORS } from "../tots/TotFaceEditor";
import { useAvatarLibrarySync } from "../tots/useAvatarLibrarySync";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  avatarExportFile,
  avatarIdOf,
  parseAvatarExport,
  withOpenBotFigure,
} from "./avatarLibrary.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const FINISHES: ReadonlyArray<{ id: TotOpenBotMaterial; label: string }> = [
  { id: "flat", label: msg("Flat", { $context: "avatar finish" }) },
  { id: "fluffy", label: msg("Fluffy", { $context: "avatar finish" }) },
  { id: "glass", label: msg("Glass", { $context: "avatar finish" }) },
  { id: "soft", label: msg("Soft", { $context: "avatar finish" }) },
];

type Tab = "figures" | "themes";

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Settings → Avatar library: one environment's open-bot figures and face themes. */
export function AvatarLibrarySettings() {
  const setting = useSearchableSetting();
  const { environment } = useSettingsScope();
  const environmentId =
    environment?.connection.phase === "connected" ? environment.environmentId : null;
  return (
    <SettingsPageContainer width="wide">
      {environmentId === null ? (
        <SettingsSection {...setting("avatar-library")}>
          <SettingsRow
            title={<T>Avatar library</T>}
            description={<T>Connect an environment to manage its shapes and face themes.</T>}
          />
        </SettingsSection>
      ) : (
        <ConnectedAvatarLibrary key={environmentId} environmentId={environmentId} />
      )}
    </SettingsPageContainer>
  );
}

function ConnectedAvatarLibrary(props: { readonly environmentId: EnvironmentId }) {
  const canWrite = useAtomValue(
    serverEnvironment.saveAvatarLibraryItem.permissionAtom(props.environmentId),
  );
  return (
    <>
      <AvatarLibraryPage environmentId={props.environmentId} canWrite={canWrite} />
      <ShapeModelSection environmentId={props.environmentId} />
    </>
  );
}

/**
 * The library in a dialog over the Tot editor, so "Manage shapes…" keeps the face being edited: shapes saved
 * here show in its figure list as soon as they are saved.
 */
export function AvatarLibraryDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The face being edited, so tiles preview in its color. */
  readonly color?: string | undefined;
}) {
  const canWrite = useAtomValue(
    serverEnvironment.saveAvatarLibraryItem.permissionAtom(props.environmentId),
  );
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-5xl">
        <DialogHeader className="sr-only">
          <DialogTitle>
            <T>Avatar library</T>
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <AvatarLibraryPage
            environmentId={props.environmentId}
            canWrite={canWrite}
            initialColor={props.color}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** The figures and themes tabs; `canWrite` follows the client's operate scope. */
export function AvatarLibraryPage(props: {
  readonly environmentId: EnvironmentId;
  readonly canWrite: boolean;
  readonly initialColor?: string | undefined;
}) {
  const { environmentId, canWrite } = props;
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting();
  useAvatarLibrarySync([environmentId], "avatar-library-page");
  const library = useEnvironmentAvatarLibrary(environmentId);
  const kit = useOpenBotKit(true);
  const [tab, setTab] = useState<Tab>("figures");
  const [color, setColor] = useState(props.initialColor ?? TOT_FACE_COLORS[0]!);
  const [finish, setFinish] = useState<TotOpenBotMaterial>("flat");
  const save = useAtomCommand(serverEnvironment.saveAvatarLibraryItem, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.removeAvatarLibraryItem, {
    reportFailure: false,
  });
  const importInput = useRef<HTMLInputElement | null>(null);

  const saveItem = async (item: AvatarLibraryExport, failureTitle: string) => {
    const result = await save({ environmentId, input: item });
    if (result._tag === "Success") {
      setAvatarLibrary(environmentId, result.value);
      return true;
    }
    if (!isAtomCommandInterrupted(result)) {
      reportFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return false;
  };
  const removeItem = async (kind: AvatarLibraryKind, id: string) => {
    const result = await remove({ environmentId, input: { kind, id } });
    if (result._tag === "Success") setAvatarLibrary(environmentId, result.value);
    else if (!isAtomCommandInterrupted(result)) {
      reportFailure(gt("Could not delete it"), squashAtomCommandFailure(result));
    }
  };
  const importFile = async (file: File) => {
    const item = parseAvatarExport(await file.text());
    if (item === null) {
      reportFailure(
        gt("Could not import {name}", { name: file.name }),
        gt("It is not an avatar library export."),
      );
      return;
    }
    if (await saveItem(item, gt("Could not import {name}", { name: file.name }))) {
      toastManager.add({
        type: "success",
        title: gt("Imported {name}", {
          name: item.kind === "figure" ? item.figure.name : item.theme.name,
        }),
      });
    }
  };
  const exportItem = (item: AvatarLibraryExport) => {
    const file = avatarExportFile(item);
    downloadPlanAsTextFile(file.name, file.text);
  };

  const builtInFigures = kit?.figures ?? [];
  const figureTiles = [
    ...library.figures.map((figure) => ({ figure, mine: true })),
    ...builtInFigures.map((figure) => ({ figure, mine: false })),
  ];
  const themeTiles = [
    ...library.themes.map((theme) => ({ theme, mine: true })),
    ...TOT_BUILT_IN_THEMES.map((theme) => ({ theme, mine: false })),
  ];

  return (
    <SettingsSection
      {...setting("avatar-library")}
      headerAction={
        canWrite ? (
          <>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label={gt("Import file")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) void importFile(file);
              }}
            />
            <Button size="sm" variant="outline" onClick={() => importInput.current?.click()}>
              <T>Import…</T>
            </Button>
          </>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
        <ToggleGroup
          aria-label={gt("Library section")}
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            if (next[0] === "figures" || next[0] === "themes") setTab(next[0]);
          }}
        >
          <Toggle value="figures">
            <T>Figures</T>
          </Toggle>
          <Toggle value="themes">
            <T>Face themes</T>
          </Toggle>
        </ToggleGroup>
        {tab === "figures" ? (
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label={gt("Preview color")}
            >
              {TOT_FACE_COLORS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-label={gt("Preview color {color}", { color: choice })}
                  aria-pressed={color === choice}
                  className="size-5 rounded-full border border-border aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-ring"
                  style={{ backgroundColor: choice }}
                  onClick={() => setColor(choice)}
                />
              ))}
            </div>
            <ToggleGroup
              aria-label={gt("Preview finish")}
              variant="segmented"
              value={[finish]}
              onValueChange={(next) => {
                const picked = FINISHES.find((entry) => entry.id === next[0]);
                if (picked) setFinish(picked.id);
              }}
            >
              {FINISHES.map((entry) => (
                <Toggle key={entry.id} value={entry.id}>
                  {m(entry.label)}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
        ) : null}
      </div>
      {tab === "figures" ? (
        <>
          {canWrite ? (
            <DescribeShape
              environmentId={environmentId}
              color={color}
              onSave={(figure) =>
                saveItem({ kind: "figure", figure }, gt("Could not save the shape"))
              }
            />
          ) : null}
          <TileGrid>
            {figureTiles.map(({ figure, mine }) => (
              <FigureTile
                key={`${mine ? "mine" : "built-in"}:${figure.id}`}
                figure={figure}
                color={color}
                finish={finish}
                mine={mine}
                actions={
                  mine && canWrite ? (
                    <ItemActions
                      environmentId={environmentId}
                      name={figure.name}
                      onRename={(name) =>
                        saveItem(
                          { kind: "figure", figure: { ...figure, name } },
                          gt("Could not rename it"),
                        )
                      }
                      onExport={() => exportItem({ kind: "figure", figure })}
                      onDelete={() => removeItem("figure", figure.id)}
                      applyTo={(avatar) => withOpenBotFigure(avatar, figure.id)}
                    />
                  ) : canWrite ? (
                    <ItemActions
                      environmentId={environmentId}
                      name={figure.name}
                      applyTo={(avatar) => withOpenBotFigure(avatar, figure.id)}
                    />
                  ) : null
                }
              />
            ))}
          </TileGrid>
        </>
      ) : (
        <TileGrid>
          {themeTiles.map(({ theme, mine }) => (
            <Tile
              key={`${mine ? "mine" : "built-in"}:${theme.id}`}
              name={theme.name}
              mine={mine}
              preview={<TotFace avatar={theme.avatar} state="idle" animation="still" size={88} />}
              actions={
                canWrite ? (
                  <ItemActions
                    environmentId={environmentId}
                    name={theme.name}
                    applyTo={() => theme.avatar}
                    {...(mine
                      ? {
                          onRename: (name: string) =>
                            saveItem(
                              { kind: "theme", theme: { ...theme, name } satisfies AvatarTheme },
                              gt("Could not rename it"),
                            ),
                          onExport: () => exportItem({ kind: "theme", theme }),
                          onDelete: () => removeItem("theme", theme.id),
                        }
                      : {})}
                  />
                ) : null
              }
            />
          ))}
        </TileGrid>
      )}
    </SettingsSection>
  );
}

function TileGrid(props: { readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 px-3 pt-1 pb-3 sm:px-4">
      {props.children}
    </div>
  );
}

function Tile(props: {
  readonly name: string;
  readonly mine: boolean;
  readonly preview: ReactNode;
  readonly actions: ReactNode;
}) {
  return (
    <div
      className="group relative flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card px-2 pt-3 pb-2"
      data-avatar-tile={props.name}
    >
      <div className="flex size-24 items-center justify-center">{props.preview}</div>
      <div className="flex w-full min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm">{props.name}</span>
        <Badge size="sm" variant={props.mine ? "info" : "outline"}>
          {props.mine ? <T>Mine</T> : <T>Built-in</T>}
        </Badge>
      </div>
      {props.actions === null ? null : (
        <div className="absolute top-1 right-1">{props.actions}</div>
      )}
    </div>
  );
}

function FigureTile(props: {
  readonly figure: AvatarDefinition;
  readonly color: string;
  readonly finish: TotOpenBotMaterial;
  readonly mine: boolean;
  readonly actions: ReactNode;
  readonly size?: number;
}) {
  return (
    <Tile
      name={props.figure.name}
      mine={props.mine}
      actions={props.actions}
      preview={
        <StillFigure
          figure={props.figure}
          color={props.color}
          finish={props.finish}
          size={props.size ?? 88}
        />
      }
    />
  );
}

/** The ⋯ menu on a tile: apply to a Tot, and for your own items rename, export and delete. */
function ItemActions(props: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly applyTo: (avatar: TotAvatar) => TotAvatar;
  readonly onRename?: (name: string) => Promise<boolean>;
  readonly onExport?: () => void;
  readonly onDelete?: () => Promise<void>;
}) {
  const gt = useGT();
  const tots = useEnvironmentSettings(props.environmentId, (settings) => settings.tots);
  const updateTot = useAtomCommand(serverEnvironment.updateTot, { reportFailure: false });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { onRename, onExport, onDelete } = props;

  const apply = async (tot: (typeof tots)[number]) => {
    const result = await updateTot({
      environmentId: props.environmentId,
      input: { id: tot.id, avatar: props.applyTo(tot.avatar) },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("{tot} now uses {name}", { tot: tot.name, name: props.name }),
      });
    } else if (!isAtomCommandInterrupted(result)) {
      reportFailure(
        gt("Could not update {tot}", { tot: tot.name }),
        squashAtomCommandFailure(result),
      );
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Actions for {name}", { name: props.name })}
            />
          }
        >
          ⋯
        </MenuTrigger>
        <MenuPopup align="end">
          {tots.length === 0 ? (
            <MenuItem disabled>
              <T>No Tots to apply to</T>
            </MenuItem>
          ) : (
            tots.map((tot) => (
              <MenuItem key={tot.id} onClick={() => void apply(tot)}>
                {gt("Apply to {tot}", { tot: tot.name })}
              </MenuItem>
            ))
          )}
          {onRename === undefined && onExport === undefined && onDelete === undefined ? null : (
            <MenuSeparator />
          )}
          {onRename === undefined ? null : (
            <MenuItem onClick={() => setRenaming(props.name)}>
              <T>Rename…</T>
            </MenuItem>
          )}
          {onExport === undefined ? null : (
            <MenuItem onClick={onExport}>
              <T>Export to a file</T>
            </MenuItem>
          )}
          {onDelete === undefined ? null : (
            <MenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
              <T>Delete…</T>
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
      {onRename === undefined ? null : (
        <AlertDialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <T>
                  Rename <Var>{props.name}</Var>
                </T>
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="px-6 pb-2">
              <Input
                aria-label={gt("Name")}
                maxLength={40}
                value={renaming ?? ""}
                onChange={(event) => setRenaming(event.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </AlertDialogClose>
              <Button
                disabled={(renaming ?? "").trim().length === 0}
                onClick={() =>
                  void onRename((renaming ?? "").trim()).then((saved) => {
                    if (saved) setRenaming(null);
                  })
                }
              >
                <T>Rename</T>
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
      {onDelete === undefined ? null : (
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <T>
                  Delete <Var>{props.name}</Var>?
                </T>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <T>
                  It leaves this environment's library. A Tot still wearing it draws the default
                  figure instead. Export it first to keep a copy.
                </T>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </AlertDialogClose>
              <Button
                variant="destructive"
                onClick={() => void onDelete().then(() => setConfirmingDelete(false))}
              >
                <T>Delete</T>
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
    </>
  );
}

/** Type a description, see the generated figure in every finish, then save, retry or edit it. */
function DescribeShape(props: {
  readonly environmentId: EnvironmentId;
  readonly color: string;
  readonly onSave: (figure: AvatarFigure) => Promise<boolean>;
}) {
  const gt = useGT();
  const m = useMessages();
  const describe = useAtomCommand(serverEnvironment.describeAvatarFigure, {
    reportFailure: false,
  });
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<AvatarFigure | null>(null);

  const generate = async () => {
    const text = description.trim();
    if (text.length === 0) return;
    setPending(true);
    const result = await describe({
      environmentId: props.environmentId,
      input: { description: text },
    });
    setPending(false);
    if (result._tag === "Success") setDraft(result.value.figure);
    else if (!isAtomCommandInterrupted(result)) {
      reportFailure(gt("Could not design that shape"), squashAtomCommandFailure(result));
    }
  };
  const idValid = draft !== null && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id);

  return (
    <div
      className="flex flex-col gap-2 border-t border-border/60 px-3 py-3 sm:px-4"
      data-describe-shape
    >
      <label className="text-sm font-medium" htmlFor="avatar-describe-shape">
        <T>Describe a shape</T>
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <Textarea
          id="avatar-describe-shape"
          className="min-w-64 flex-1"
          rows={2}
          maxLength={500}
          placeholder={gt("A pink fairy with butterfly wings")}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void generate();
          }}
        />
        <Button
          disabled={pending || description.trim().length === 0}
          onClick={() => void generate()}
        >
          {pending ? <T>Designing…</T> : draft === null ? <T>Design it</T> : <T>Try again</T>}
        </Button>
      </div>
      {draft === null ? null : (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div
            className="flex flex-wrap items-end justify-center gap-3"
            aria-label={gt("Generated shape")}
          >
            {FINISHES.map((entry) => (
              <div key={entry.id} className="flex flex-col items-center gap-1">
                <StillFigure figure={draft} color={props.color} finish={entry.id} size={104} />
                <span className="text-muted-foreground text-xs">{m(entry.label)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={gt("Shape name")}
              className="w-44"
              maxLength={40}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Input
              aria-label={gt("Shape id")}
              className="w-44"
              maxLength={48}
              value={draft.id}
              aria-invalid={!idValid}
              onChange={(event) => setDraft({ ...draft, id: event.target.value })}
              onBlur={() => setDraft({ ...draft, id: avatarIdOf(draft.id) || draft.id })}
            />
            <div className="ms-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                <T>Discard</T>
              </Button>
              <Button
                disabled={!idValid || draft.name.trim().length === 0}
                onClick={() =>
                  void props.onSave({ ...draft, name: draft.name.trim() }).then((saved) => {
                    if (saved) {
                      setDraft(null);
                      setDescription("");
                    }
                  })
                }
              >
                <T>Save to library</T>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The model "Describe a shape" uses; off follows the environment's text generation model. */
function ShapeModelSection(props: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const providers = useEnvironmentProviders().get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const targets = useTextGenerationTargets({
    environmentId: props.environmentId,
    settings,
    providers: providers.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: null,
    selections: [settings.avatarDesignModelSelection, settings.textGenerationModelSelection],
  });
  const instanceEntries = targets.entries;
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const dedicated = settings.avatarDesignModelSelection !== null;
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveAvatarDesignModelSelection(settings, targets.providers),
    },
    targets.providers,
  );
  const modelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    targets.providers,
    selection.instanceId,
    selection.model,
  );
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries, true);
  const setModel = (next: ReturnType<typeof createModelSelection>) => {
    const reason = modelDisabledReason(next.instanceId, next.model);
    if (reason) {
      toastManager.add({ type: "error", title: gt("Shape model not saved"), description: reason });
      return;
    }
    updateSettings({ avatarDesignModelSelection: next });
  };
  return (
    <SettingsSection title={gt("Designing shapes")}>
      <SettingsRow
        serverScoped
        settingKeys={["avatarDesignModelSelection"]}
        {...setting("avatar-design-model")}
        title={gt("Shape model")}
        description={gt(
          "Model for Describe a shape. A capable but inexpensive one is enough. When off, use this environment's text generation model.",
        )}
        control={
          <div className="flex min-w-0 flex-wrap items-center gap-2 @min-[32rem]/settings-row:justify-end">
            {dedicated && hasProvider && instanceEntry ? (
              <>
                <ProviderModelPicker
                  environmentId={props.environmentId}
                  activeInstanceId={selection.instanceId}
                  model={selection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  getModelDisabledReason={modelDisabledReason}
                  onInstanceModelChange={(instanceId, model) =>
                    setModel(pickModelSelection(selection, instanceId, model))
                  }
                />
                <TraitsPicker
                  provider={instanceEntry.driverKind}
                  models={instanceEntry.models}
                  model={selection.model}
                  modelOptions={selection.options ?? []}
                  allowPromptInjectedEffort={false}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(options) =>
                    setModel(createModelSelection(selection.instanceId, selection.model, options))
                  }
                />
              </>
            ) : null}
            <Switch
              checked={dedicated}
              disabled={!dedicated && !hasProvider}
              onCheckedChange={(checked) =>
                updateSettings({
                  avatarDesignModelSelection: checked
                    ? createModelSelection(
                        settings.textGenerationModelSelection.instanceId,
                        settings.textGenerationModelSelection.model,
                        settings.textGenerationModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label={gt("Use a separate shape model")}
            />
          </div>
        }
      />
    </SettingsSection>
  );
}
