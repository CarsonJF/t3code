import { describeBuildIdentity } from "@t3tools/shared/buildIdentity";
import { cliReleaseChannelOf } from "@t3tools/shared/cliRelease";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  fetchLatestReleaseBuild,
  type ForceUpdatePlan,
  type ForceUpdateSubject,
  planForceUpdate,
} from "./forceUpdate.logic";

type ButtonProps = Pick<
  ComponentProps<typeof Button>,
  "variant" | "size" | "className" | "disabled"
>;

export interface ForceUpdateActionProps extends ButtonProps {
  readonly subject: ForceUpdateSubject;
  /** Platform archive whose digest the release check should read, when one applies. */
  readonly platformKey?: string | undefined;
  readonly label?: string;
  readonly onInstall: (plan: ForceUpdatePlan) => Promise<boolean>;
}

function BuildRow({
  label,
  version,
  build,
  href,
}: {
  readonly label: string;
  readonly version: string;
  readonly build: string;
  readonly href?: string | undefined;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-4 border-b border-border/50 py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">
        <span className="font-mono text-xs">{version}</span>
        <span className="block text-muted-foreground text-xs">
          {build}
          {href === undefined ? null : (
            <>
              {" · "}
              <a
                className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                release
                <ExternalLinkIcon aria-hidden className="size-3" />
              </a>
            </>
          )}
        </span>
      </span>
    </div>
  );
}

function ForceUpdateDialog({
  open,
  onOpenChange,
  subject,
  plan,
  busy,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly subject: ForceUpdateSubject;
  readonly plan: ForceUpdatePlan;
  readonly busy: boolean;
  readonly onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup className="sm:max-w-lg" initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>Force update {subject.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Re-checks the latest build from this fork's releases and installs it even when the
            version did not change.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-2">
          <div className="rounded-md border border-border/60 px-3">
            <BuildRow
              label="Current"
              version={subject.current.version}
              build={describeBuildIdentity(subject.current)}
            />
            <BuildRow
              label="Available"
              version={plan.available.version}
              build={describeBuildIdentity(plan.available)}
              href={plan.available.releaseUrl}
            />
          </div>
          <p className="text-muted-foreground text-sm">{plan.comparison.reason}</p>
          {plan.installable ? (
            <p className="text-sm">{plan.restartNote}</p>
          ) : (
            <p className="text-destructive text-sm">{plan.blockReason}</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogClose ref={cancelRef} render={<Button variant="outline" disabled={busy} />}>
            Cancel
          </AlertDialogClose>
          <Button disabled={!plan.installable || busy} onClick={onConfirm}>
            {busy ? "Installing…" : plan.sameVersion ? "Install build" : "Install update"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** Checks the release before opening, so the dialog can show both builds before confirming. */
export function ForceUpdateAction({
  subject,
  platformKey,
  label = "Force update",
  onInstall,
  ...buttonProps
}: ForceUpdateActionProps) {
  const [checking, setChecking] = useState(false);
  const [plan, setPlan] = useState<ForceUpdatePlan | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    if (checking) return;
    setChecking(true);
    const result = await fetchLatestReleaseBuild({
      channel: cliReleaseChannelOf(subject.current.version),
      platformKey,
    }).then(
      (available) => ({ ok: true as const, available }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    setChecking(false);
    if (!result.ok) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not check ${subject.label}`,
          description:
            result.error instanceof Error ? result.error.message : "The release check failed.",
        }),
      );
      return;
    }
    setPlan(planForceUpdate(subject, result.available));
  };

  return (
    <>
      <Button
        {...buttonProps}
        disabled={checking || buttonProps.disabled}
        onClick={() => void check()}
      >
        <RefreshCwIcon aria-hidden />
        {checking ? "Checking…" : label}
      </Button>
      {plan === null ? null : (
        <ForceUpdateDialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setPlan(null);
          }}
          subject={subject}
          plan={plan}
          busy={busy}
          onConfirm={() => {
            if (busy || !plan.installable) return;
            setBusy(true);
            void onInstall(plan).then((installed) => {
              setBusy(false);
              if (installed) setPlan(null);
            });
          }}
        />
      )}
    </>
  );
}
