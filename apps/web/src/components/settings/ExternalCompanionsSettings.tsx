import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  isSecretReference,
  type AuthMcpClientAccess,
  type CompanionManifest,
  type EnvironmentId,
  type ExternalCompanionConfig,
  type ExternalCompanionGrantIssueResult,
  type ExternalCompanionStatus,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  CopyIcon,
  KeyRoundIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useCompanions } from "../../state/companions";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { CompanionFace } from "../companions/CompanionFace";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

const ACCESS_LABELS: Record<AuthMcpClientAccess, string> = {
  "read-only": msg("Read only"),
  "approval-required": msg("Ask before acting"),
  "auto-accept-edits": msg("Accept edits"),
  auto: msg("Auto"),
  "full-access": msg("Full access"),
};

const errorText = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
};

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "companion";

const sameOrigin = (left: string, right: string) => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

/** Settings → External Companions: one environment's companions, tokens and MCP grants. */
export function ExternalCompanionsSettings() {
  const setting = useSearchableSetting();
  const { environment } = useSettingsScope();
  const environmentId =
    environment?.connection.phase === "connected" ? environment.environmentId : null;
  return (
    <SettingsPageContainer>
      {environmentId === null ? (
        <SettingsSection {...setting("external-companions")}>
          <SettingsRow
            title={<T>External Companions</T>}
            description={<T>Connect an environment to manage its companions.</T>}
          />
        </SettingsSection>
      ) : (
        <CompanionList key={environmentId} environmentId={environmentId} />
      )}
    </SettingsPageContainer>
  );
}

type Editing = { readonly config: ExternalCompanionConfig; readonly isNew: boolean } | null;

function CompanionList(props: { readonly environmentId: EnvironmentId }) {
  const setting = useSearchableSetting();
  const gt = useGT();
  const configs = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.externalCompanions,
  );
  const statuses = useCompanions().filter((entry) => entry.environmentId === props.environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const canWrite = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(props.environmentId),
  );
  const [editing, setEditing] = useState<Editing>(null);
  const [granting, setGranting] = useState<ExternalCompanionStatus | null>(null);
  const save = async (next: ReadonlyArray<ExternalCompanionConfig>) => {
    const result = await update({
      environmentId: props.environmentId,
      input: { patch: { externalCompanions: next } },
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return true;
    toastManager.add({
      type: "error",
      title: gt("Could not save the companions"),
      description: errorText(result),
    });
    return false;
  };
  const statusOf = (id: string) => statuses.find((entry) => entry.companion.id === id)?.companion;
  return (
    <SettingsSection
      {...setting("external-companions")}
      headerAction={
        <Button
          size="xs"
          variant="outline"
          disabled={!canWrite}
          onClick={() =>
            setEditing({ config: { id: "", label: "", baseUrl: "", token: "" }, isNew: true })
          }
        >
          <PlusIcon />
          <T>Add companion</T>
        </Button>
      }
    >
      <SettingsRow
        title={<T>Companions</T>}
        description={
          <T>
            Agent services you run elsewhere that speak External Companion Protocol v1. This server
            talks to them, so their tokens stay here.
          </T>
        }
      />
      {configs.length === 0 ? (
        <SettingsRow
          title={<T>No companions yet</T>}
          description={<T>Add one with its URL and token.</T>}
        />
      ) : null}
      {configs.map((config) => {
        const status = statusOf(config.id);
        return (
          <CompanionSettingsRow
            key={config.id}
            config={config}
            status={status}
            canWrite={canWrite}
            onEdit={() => setEditing({ config, isNew: false })}
            onRemove={() => void save(configs.filter((entry) => entry.id !== config.id))}
            onGrant={() => (status === undefined ? undefined : setGranting(status))}
            environmentId={props.environmentId}
          />
        );
      })}
      {editing === null ? null : (
        <CompanionEditor
          environmentId={props.environmentId}
          initial={editing.config}
          isNew={editing.isNew}
          takenIds={new Set(configs.map((entry) => entry.id))}
          onClose={() => setEditing(null)}
          onSave={async (config) => {
            const next = editing.isNew
              ? [...configs, config]
              : configs.map((entry) => (entry.id === config.id ? config : entry));
            if (await save(next)) setEditing(null);
          }}
        />
      )}
      {granting === null ? null : (
        <GrantDialog
          environmentId={props.environmentId}
          companion={granting}
          onClose={() => setGranting(null)}
        />
      )}
    </SettingsSection>
  );
}

function CompanionSettingsRow(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ExternalCompanionConfig;
  readonly status: ExternalCompanionStatus | undefined;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  readonly onGrant: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { config, status } = props;
  const revoke = useAtomCommand(serverEnvironment.revokeCompanionGrant, { reportFailure: false });
  const canGrant = useAtomValue(
    serverEnvironment.issueCompanionGrant.permissionAtom(props.environmentId),
  );
  const online = status?.connection === "connected";
  const grant = status?.grant ?? null;
  return (
    <SettingsRow
      data-companion-settings={config.id}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <CompanionFace
            avatar={status?.manifest?.avatar}
            seed={config.id}
            state={status?.avatarStates.main}
            online={online}
            size={20}
          />
          <span className="truncate">{status?.label ?? (config.label || config.id)}</span>
          <Badge variant={online ? "secondary" : "outline"} size="sm">
            {online ? (
              <T>Connected</T>
            ) : status?.connection === "connecting" ? (
              <T>Connecting</T>
            ) : (
              <T>Offline</T>
            )}
          </Badge>
        </span>
      }
      description={
        <span className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-xs">{config.baseUrl}</span>
          {!online && status?.error ? <span>{status.error}</span> : null}
          {grant === null ? null : (
            <span>
              {grant.connectedAt === null ? (
                <T>
                  MCP grant issued (<Var>{m(ACCESS_LABELS[grant.access])}</Var>), waiting for the
                  companion to exchange its setup code.
                </T>
              ) : (
                <T>
                  MCP access: <Var>{m(ACCESS_LABELS[grant.access])}</Var>. Renews itself while used.
                </T>
              )}
            </span>
          )}
        </span>
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-1">
          {grant === null ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canGrant || status === undefined}
              onClick={props.onGrant}
            >
              <KeyRoundIcon />
              <T>MCP grant</T>
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={!canGrant}
              onClick={() =>
                void revoke({
                  environmentId: props.environmentId,
                  input: { companionId: config.id },
                }).then((result) => {
                  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
                  toastManager.add({
                    type: "error",
                    title: gt("Could not revoke the grant"),
                    description: errorText(result),
                  });
                })
              }
            >
              <T>Revoke MCP</T>
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Edit")}
            disabled={!props.canWrite}
            onClick={props.onEdit}
          >
            <PencilIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Remove")}
            disabled={!props.canWrite}
            onClick={props.onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      }
    />
  );
}

function CompanionEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly initial: ExternalCompanionConfig;
  readonly isNew: boolean;
  readonly takenIds: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onSave: (config: ExternalCompanionConfig) => Promise<void>;
}) {
  const gt = useGT();
  const sources = useSecretSources(props.environmentId);
  const test = useAtomCommand(serverEnvironment.testCompanion, { reportFailure: false });
  const [baseUrl, setBaseUrl] = useState(props.initial.baseUrl);
  // Undefined keeps the saved token, which goes only to the origin it was saved for.
  const [token, setToken] = useState<SettingsSecretValue | undefined>(
    isSecretReference(props.initial.token) ? props.initial.token : undefined,
  );
  const [tested, setTested] = useState<
    | { readonly kind: "ok"; readonly manifest: CompanionManifest }
    | { readonly kind: "error"; readonly message: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const savedToken =
    !props.isNew && props.initial.token !== "" && sameOrigin(props.initial.baseUrl, baseUrl);
  const tokenGiven = token !== undefined && token !== "";
  const urlValid = /^https?:\/\/[^\s]+$/.test(baseUrl.trim());
  const runTest = async () => {
    setBusy(true);
    const result = await test({
      environmentId: props.environmentId,
      input: {
        baseUrl: baseUrl.trim(),
        ...(tokenGiven ? { token } : {}),
        ...(props.isNew ? {} : { companionId: props.initial.id }),
      },
    });
    setBusy(false);
    if (result._tag === "Success") setTested({ kind: "ok", manifest: result.value });
    else if (!isAtomCommandInterrupted(result))
      setTested({ kind: "error", message: errorText(result) });
  };
  const save = async () => {
    const manifest = tested?.kind === "ok" ? tested.manifest : null;
    let id = props.initial.id;
    if (props.isNew) {
      const base = slug(manifest?.id ?? manifest?.name ?? new URL(baseUrl.trim()).hostname);
      id = base;
      for (let n = 2; props.takenIds.has(id); n += 1) id = `${base}-${n}`;
    }
    setBusy(true);
    await props.onSave({
      id,
      label: manifest?.name ?? props.initial.label,
      baseUrl: baseUrl.trim(),
      token: tokenGiven ? (token as SettingsSecretValue) : props.initial.token,
    });
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.isNew ? <T>Add a companion</T> : <T>Edit companion</T>}</DialogTitle>
          <DialogDescription>
            <T>T3 reads its manifest from the base URL and sends the token as a bearer token.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <T>Base URL</T>
              <Input
                value={baseUrl}
                placeholder="http://127.0.0.1:4790"
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setTested(null);
                }}
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <T>Token</T>
              <SecretSourceInput
                aria-label={gt("Token")}
                environmentId={props.environmentId}
                configured={savedToken && token === undefined}
                value={token === undefined ? "" : token}
                sources={sources}
                onSecretChange={(secret) => {
                  setToken(secret);
                  setTested(null);
                }}
                onChange={(event) => {
                  setToken(event.target.value === "" ? undefined : event.target.value);
                  setTested(null);
                }}
              />
              {!props.isNew && !savedToken && !tokenGiven ? (
                <span className="text-xs text-muted-foreground">
                  <T>
                    A new origin needs the token again: a saved token only goes where it was saved
                    for.
                  </T>
                </span>
              ) : null}
            </div>
            {tested?.kind === "ok" ? (
              <div
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                data-companion-test="ok"
              >
                <CompanionFace
                  avatar={tested.manifest.avatar}
                  seed={tested.manifest.id}
                  state="idle"
                  online
                  size={28}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{tested.manifest.name}</span>
                  {tested.manifest.tagline ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {tested.manifest.tagline}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {tested?.kind === "error" ? (
              <p className="text-sm text-destructive-foreground" data-companion-test="error">
                {tested.message}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy || !urlValid || (!tokenGiven && !savedToken)}
            onClick={() => void runTest()}
          >
            <PlugZapIcon />
            <T>Test connection</T>
          </Button>
          <Button
            disabled={busy || !urlValid || (!tokenGiven && !savedToken)}
            onClick={() => void save()}
          >
            <T>Save</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function GrantDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const issue = useAtomCommand(serverEnvironment.issueCompanionGrant, { reportFailure: false });
  const [access, setAccess] = useState<AuthMcpClientAccess>("approval-required");
  const [issued, setIssued] = useState<ExternalCompanionGrantIssueResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const run = async () => {
    setBusy(true);
    const result = await issue({
      environmentId: props.environmentId,
      input: { companionId: props.companion.id, access },
    });
    setBusy(false);
    if (result._tag === "Success") setIssued(result.value);
    else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: gt("Could not issue the grant"),
        description: errorText(result),
      });
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <T>
              MCP grant for <Var>{props.companion.label}</Var>
            </T>
          </DialogTitle>
          <DialogDescription>
            <T>
              The companion trades a setup code for one-hour MCP access that it renews itself, only
              from this machine. Revoke it here at any time.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            {issued === null ? (
              <label className="flex flex-col gap-1 text-sm">
                <T>Access</T>
                <Select
                  value={access}
                  onValueChange={(value) => {
                    if (value !== null && value in ACCESS_LABELS)
                      setAccess(value as AuthMcpClientAccess);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("Access")}>
                    <SelectValue>{m(ACCESS_LABELS[access])}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {(Object.keys(ACCESS_LABELS) as AuthMcpClientAccess[]).map((level) => (
                      <SelectItem key={level} value={level}>
                        {m(ACCESS_LABELS[level])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            ) : (
              <>
                <p className="text-sm">
                  <T>
                    Give the companion this setup code. It works once, within ten minutes, and is
                    not shown again.
                  </T>
                </p>
                <div className="flex items-center gap-2">
                  <code
                    className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 font-mono text-xs"
                    data-companion-setup-code
                  >
                    {issued.setupCode}
                  </code>
                  <Button
                    size="icon-xs"
                    variant="outline"
                    aria-label={gt("Copy")}
                    onClick={() => copyToClipboard(issued.setupCode, undefined)}
                  >
                    <CopyIcon />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isCopied ? <T>Copied.</T> : null} <T>Token endpoint:</T>{" "}
                  <code className="font-mono">{issued.tokenEndpoint}</code>
                </p>
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          {issued === null ? (
            <Button disabled={busy} onClick={() => void run()}>
              <T>Issue setup code</T>
            </Button>
          ) : (
            <Button onClick={props.onClose}>
              <T>Done</T>
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
