import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  TOT_FACE_STATE_LABELS,
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useTots } from "~/state/tots";
import { Button } from "../ui/button";
import { TotAvatar } from "./TotAvatar";
import { totTint, useTotAccent } from "./totAccent";

const HERO_COLLAPSED_KEY = "t3code:tot-hero-collapsed";

/** The Tot whose current thread this is, if any. */
function useTotForThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): EnvironmentTot | undefined {
  return useTots().find(
    (candidate) => candidate.environmentId === environmentId && candidate.tot.threadId === threadId,
  );
}

/** The header's half of a wash of the Tot's color that fades out through the hero. */
export function TotHeaderTint(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const entry = useTotForThread(props.environmentId, props.threadId);
  if (entry === undefined) return null;
  return <TotHeaderTintLayer entry={entry} />;
}

function TotHeaderTintLayer(props: { readonly entry: EnvironmentTot }) {
  const accent = useTotAccent(props.entry.tot.avatar);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        backgroundImage: `linear-gradient(to bottom, ${totTint(accent, 18)}, ${totTint(accent, 13)})`,
      }}
    />
  );
}

/** The Tot itself above its conversation: the one you are talking to. */
export function TotThreadHero(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const entry = useTotForThread(props.environmentId, props.threadId);
  if (entry === undefined) return null;
  return <TotHero entry={entry} environmentId={props.environmentId} threadId={props.threadId} />;
}

function TotHero(props: {
  readonly entry: EnvironmentTot;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { tot } = props.entry;
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const shell = useThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const accent = useTotAccent(tot.avatar);
  const [collapsed, setCollapsed] = useLocalStorage(HERO_COLLAPSED_KEY, false, Schema.Boolean);
  const state = totFaceState(totFaceInputFromShell(tot, shell));
  const animation = resolveTotAnimation("own-view", animate, reducedMotion);
  const status = (
    <span className="text-muted-foreground text-xs" aria-live="polite">
      {TOT_FACE_STATE_LABELS[state]}
    </span>
  );
  const toggle = (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={collapsed ? `Show ${tot.name} large` : `Make ${tot.name} small`}
      aria-expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)}
    >
      {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
    </Button>
  );
  return (
    <div
      className="relative shrink-0"
      style={{ backgroundImage: `linear-gradient(to bottom, ${totTint(accent, 13)}, transparent)` }}
    >
      {collapsed ? (
        <div className="flex items-center justify-center gap-2.5 px-4 py-2">
          <TotAvatar avatar={tot.avatar} state={state} animation={animation} size={32} />
          <span className="font-medium text-foreground text-sm">{tot.name}</span>
          {status}
          {toggle}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 pt-4 pb-5">
          <TotAvatar avatar={tot.avatar} state={state} animation={animation} size={104} />
          <span className="font-medium text-foreground text-lg">{tot.name}</span>
          {status}
          <div className="absolute top-2 right-3">{toggle}</div>
        </div>
      )}
    </div>
  );
}
