import {
  TOT_ASK_MODES,
  TURN_CALLER_ORIGINS,
  type EnvironmentId,
  type TotAskEntry,
  type TotAskMode,
  type TotId,
  type TurnCallerOrigin,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useTots } from "../../state/tots";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TotSettingsEmpty, TotSettingsSection } from "./TotSettingsSection";
import {
  type TotCallerChoice,
  type TotCallerPatch,
  totCallerChoiceOf,
  totCallerEntryPatched,
  totCallerPick,
} from "./totWhoCanAsk.logic";

const ORIGINS: Record<TurnCallerOrigin, { readonly label: string; readonly id: string }> = {
  companion: { label: msg("External Companion"), id: msg("Companion id or client name") },
  tot: { label: msg("Another Tot"), id: msg("Tot id") },
  linked: { label: msg("Linked environment"), id: msg("Environment id") },
  webhook: { label: msg("Webhook"), id: msg("Webhook task id") },
  discord: { label: msg("Discord user"), id: msg("Discord user id") },
  agent: { label: msg("Agent thread"), id: msg("Thread id") },
};

const MODES: Record<TotAskMode, string> = {
  full: msg("Full access"),
  ask: msg("Ask before changes"),
  "read-only": msg("Read-only"),
};

const EMPTY_CHOICES: ReadonlyArray<TotCallerChoice> = [];

/** Callers this environment knows by name, so a person picks them instead of typing ids. */
function useTotCallerChoices(
  environmentId: EnvironmentId,
  totId: TotId,
): Record<TurnCallerOrigin, ReadonlyArray<TotCallerChoice>> {
  const tots = useTots();
  const companions = useEnvironmentSettings(
    environmentId,
    (settings) => settings.externalCompanions,
  );
  const { environments } = useEnvironments();
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  return {
    tot: tots
      .filter((entry) => entry.environmentId === environmentId && entry.tot.id !== totId)
      .map((entry) => ({ id: entry.tot.id, label: entry.tot.name })),
    companion: companions.map((companion) => ({
      id: companion.id,
      label: companion.label || companion.id,
    })),
    linked: environments
      .filter((environment) => environment.environmentId !== environmentId)
      .map((environment) => ({ id: environment.environmentId, label: environment.label })),
    webhook: (tasks.data?.tasks ?? [])
      .filter((task) => task.schedule.type === "webhook")
      .map((task) => ({ id: task.id, label: task.title })),
    discord: EMPTY_CHOICES,
    agent: EMPTY_CHOICES,
  };
}

const ANYONE = "*";
const OTHER = "__other";

export function TotWhoCanAskSection(props: {
  readonly environmentId: EnvironmentId;
  readonly totId: TotId;
  readonly totName: string;
  readonly value: ReadonlyArray<TotAskEntry>;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (value: ReadonlyArray<TotAskEntry>) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const choices = useTotCallerChoices(props.environmentId, props.totId);
  const change = (index: number, patch: TotCallerPatch) =>
    props.onChange(
      props.value.map((entry, at) => (at === index ? totCallerEntryPatched(entry, patch) : entry)),
    );
  const firstCompanion = choices.companion[0];
  const addCaller = () =>
    props.onChange([
      ...props.value,
      firstCompanion === undefined
        ? { origin: "discord", id: "", mode: "ask" }
        : { origin: "companion", id: firstCompanion.id, label: firstCompanion.label, mode: "ask" },
    ]);
  return (
    <TotSettingsSection
      id="who-can-ask"
      title={<T>Who can ask</T>}
      description={gt(
        "Callers other than you that can start turns in {name}. You always have full access; anyone not listed is refused.",
        { name: props.totName },
      )}
      action={
        <Button size="sm" variant="outline" disabled={props.disabled} onClick={addCaller}>
          <PlusIcon />
          <T>Add caller</T>
        </Button>
      }
    >
      {props.value.length === 0 ? (
        <TotSettingsEmpty>
          {gt("Only you can start turns in {name}.", { name: props.totName })}
        </TotSettingsEmpty>
      ) : (
        <ul className="@container flex flex-col gap-2" aria-label={gt("Callers")}>
          {props.value.map((entry, index) => {
            const known = choices[entry.origin];
            const choice = totCallerChoiceOf(entry, known);
            return (
              <li
                // oxlint-disable-next-line react/no-array-index-key -- rows have no id until saved, and editing the id must not remount the row
                key={index}
                data-caller-origin={entry.origin}
                className="grid grid-cols-1 gap-1.5 rounded-md border border-border/60 p-2 @xs:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @xl:grid-cols-[11.5rem_minmax(0,1fr)_11rem_auto]"
              >
                <Select
                  value={entry.origin}
                  onValueChange={(origin) => {
                    const next = origin as TurnCallerOrigin;
                    const first = choices[next][0];
                    change(index, {
                      origin: next,
                      id: first?.id ?? "",
                      label: first?.label,
                    });
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("Caller type")} disabled={props.disabled}>
                    <SelectValue>{m(ORIGINS[entry.origin].label)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {TURN_CALLER_ORIGINS.map((origin) => (
                      <SelectItem key={origin} value={origin}>
                        {m(ORIGINS[origin].label)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Select
                  value={
                    choice.kind === "known"
                      ? choice.choice.id
                      : choice.kind === "anyone"
                        ? ANYONE
                        : OTHER
                  }
                  onValueChange={(value) => {
                    if (value === OTHER) {
                      change(index, { id: "" });
                      return;
                    }
                    change(index, totCallerPick(String(value), known));
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("Caller")} disabled={props.disabled}>
                    <SelectValue>
                      {choice.kind === "known"
                        ? choice.choice.label
                        : choice.kind === "anyone"
                          ? gt("Anyone of this type")
                          : entry.label || entry.id || gt("Enter an id…")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem value={ANYONE}>{gt("Anyone of this type")}</SelectItem>
                    {known.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>{gt("Enter an id…")}</SelectItem>
                  </SelectPopup>
                </Select>
                <div className="min-w-0 @xs:col-span-2 @xl:col-span-1">
                  <Select
                    value={entry.mode}
                    onValueChange={(mode) => change(index, { mode: mode as TotAskMode })}
                  >
                    <SelectTrigger size="sm" aria-label={gt("Access")} disabled={props.disabled}>
                      <SelectValue>{m(MODES[entry.mode])}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {TOT_ASK_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {m(MODES[mode])}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="@xs:col-start-3 @xs:row-start-1 @xl:col-start-auto @xl:row-start-auto">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={props.disabled}
                    aria-label={gt("Remove caller")}
                    onClick={() => props.onChange(props.value.filter((_, at) => at !== index))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                {choice.kind === "other" ? (
                  <Input
                    size="sm"
                    className="@xs:col-span-2 @xl:col-span-3"
                    value={entry.id}
                    disabled={props.disabled}
                    placeholder={m(ORIGINS[entry.origin].id)}
                    aria-label={m(ORIGINS[entry.origin].id)}
                    onChange={(event) => change(index, { id: event.currentTarget.value })}
                  />
                ) : null}
                {entry.trustedByDefault === true ? (
                  <Badge
                    variant="info"
                    size="sm"
                    className="justify-self-start @xs:col-span-3 @xl:col-span-4"
                  >
                    <T>Trusted by default</T>
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {props.error ? <p className="text-destructive-foreground text-xs">{props.error}</p> : null}
    </TotSettingsSection>
  );
}
