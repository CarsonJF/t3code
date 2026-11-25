import { type EnvironmentId } from "@t3tools/contracts";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";
import { resolveTotMemoryTidyModelSelection } from "@t3tools/shared/serverSettings";
import { useGT } from "gt-react";
import { useState } from "react";

import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { totMemoryTidyMaxBytesFromKb } from "./totMemoryTidySettings.logic";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** The environment's nightly Tot memory tidy-up: its model and the size it keeps memory under. */
export function TotMemoryTidySettings() {
  const { environment } = useSettingsScope();
  if (environment?.connection.phase !== "connected") return null;
  return <ConnectedTotMemoryTidySettings environmentId={environment.environmentId} />;
}

function ConnectedTotMemoryTidySettings(props: { readonly environmentId: EnvironmentId }) {
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
    selections: [settings.totMemoryTidyModelSelection, settings.textGenerationModelSelection],
  });
  const instanceEntries = targets.entries;
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const dedicated = settings.totMemoryTidyModelSelection !== null;
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveTotMemoryTidyModelSelection(settings, targets.providers),
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
      toastManager.add({
        type: "error",
        title: gt("Tidy-up model not saved"),
        description: reason,
      });
      return;
    }
    updateSettings({ totMemoryTidyModelSelection: next });
  };
  const savedKb = String(Math.round(settings.totMemoryTidyMaxBytes / 1024));
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);
  const commitSize = () => {
    if (sizeDraft === null) return;
    const bytes = totMemoryTidyMaxBytesFromKb(sizeDraft);
    setSizeDraft(null);
    if (bytes === null) {
      toastManager.add({
        type: "error",
        title: gt("Size cap not saved"),
        description: gt("Enter whole kilobytes from 1 to 256."),
      });
      return;
    }
    if (bytes !== settings.totMemoryTidyMaxBytes) updateSettings({ totMemoryTidyMaxBytes: bytes });
  };
  return (
    <SettingsSection title={gt("Memory tidy-up")}>
      <SettingsRow
        serverScoped
        settingKeys={["totMemoryTidyModelSelection"]}
        {...setting("tot-memory-tidy-model")}
        title={gt("Tidy-up model")}
        description={gt(
          "Model for each Tot's nightly memory tidy-up. A cheap one is enough. When off, use this environment's text generation model.",
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
                  totMemoryTidyModelSelection: checked
                    ? createModelSelection(
                        settings.textGenerationModelSelection.instanceId,
                        settings.textGenerationModelSelection.model,
                        settings.textGenerationModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label={gt("Use a separate tidy-up model")}
            />
          </div>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["totMemoryTidyMaxBytes"]}
        {...setting("tot-memory-tidy-size")}
        title={gt("Memory size cap")}
        description={gt(
          "A tidy-up keeps each Tot's {memory} under this size and moves older lines to dated logs.",
          { memory: "MEMORY.md" },
        )}
        control={
          <div className="flex items-center gap-2">
            <Input
              type="number"
              nativeInput
              min={1}
              max={256}
              className="w-24"
              aria-label={gt("Memory size cap in kilobytes")}
              value={sizeDraft ?? savedKb}
              onChange={(event) => setSizeDraft(event.target.value)}
              onBlur={commitSize}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitSize();
              }}
            />
            <span className="text-muted-foreground text-xs">KB</span>
          </div>
        }
      />
    </SettingsSection>
  );
}
