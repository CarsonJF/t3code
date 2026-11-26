import {
  TOT_ASK_MODES,
  TURN_CALLER_ORIGINS,
  type TotAskEntry,
  type TotAskMode,
  type TurnCallerOrigin,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const ORIGINS: Record<TurnCallerOrigin, { readonly label: string; readonly id: string }> = {
  discord: { label: msg("Discord user"), id: msg("Discord user id") },
  webhook: { label: msg("Webhook"), id: msg("Scheduled task id") },
  tot: { label: msg("Another Tot"), id: msg("Tot id") },
  agent: { label: msg("Agent thread"), id: msg("Thread id, or *") },
  linked: { label: msg("Linked environment"), id: msg("Environment id") },
  companion: { label: msg("Outside client"), id: msg("Client name") },
};

const MODES: Record<TotAskMode, string> = {
  full: msg("Full access"),
  ask: msg("Ask before changes"),
  "read-only": msg("Read-only"),
};

export function TotWhoCanAskSection(props: {
  readonly totName: string;
  readonly value: ReadonlyArray<TotAskEntry>;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (value: ReadonlyArray<TotAskEntry>) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  // A default entry stays one while only its mode changes; a new origin or id makes it yours.
  const change = (index: number, patch: Partial<TotAskEntry>) =>
    props.onChange(
      props.value.map((entry, at) => {
        if (at !== index) return entry;
        const next = { ...entry, ...patch };
        if (patch.origin === undefined && patch.id === undefined) return next;
        const { trustedByDefault: _default, ...own } = next;
        return own;
      }),
    );
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground text-sm">
            <T>Who can ask</T>
          </h3>
          <p className="text-muted-foreground text-xs">
            {gt(
              "You always have full access. Your other Tots, linked machines and webhooks are trusted by default; Discord users, outside clients and other agent threads are refused unless listed. Ask runs a caller's turns needing your approval for changes; Read-only lets them only look.",
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled}
          onClick={() =>
            props.onChange([...props.value, { origin: "discord", id: "", mode: "ask" }])
          }
        >
          <PlusIcon />
          <T>Add</T>
        </Button>
      </div>
      {props.value.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {gt("Only you can start turns in {name}.", { name: props.totName })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.value.map((entry, index) => (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- rows have no id until saved, and editing the id must not remount the row
              key={index}
              className="grid grid-cols-1 gap-1.5 rounded-md border border-border/60 p-2 sm:grid-cols-[10rem_1fr_9.5rem_auto]"
            >
              <Select
                value={entry.origin}
                onValueChange={(origin) => change(index, { origin: origin as TurnCallerOrigin })}
              >
                <SelectTrigger size="sm" aria-label={gt("Caller origin")} disabled={props.disabled}>
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
              <Input
                size="sm"
                value={entry.id}
                disabled={props.disabled}
                placeholder={m(ORIGINS[entry.origin].id)}
                aria-label={m(ORIGINS[entry.origin].id)}
                onChange={(event) => change(index, { id: event.currentTarget.value })}
              />
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
              {entry.trustedByDefault === true ? (
                <Badge
                  variant="info"
                  size="sm"
                  className="justify-self-start sm:order-last sm:col-span-4"
                >
                  <T>Trusted by default</T>
                </Badge>
              ) : null}
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={props.disabled}
                aria-label={gt("Remove caller")}
                onClick={() => props.onChange(props.value.filter((_, at) => at !== index))}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {props.error ? <p className="text-destructive-foreground text-xs">{props.error}</p> : null}
    </section>
  );
}
