import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  TOT_FACE_STATE_LABELS as STATE_LABELS,
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import { useNavigate } from "@tanstack/react-router";
import { memo, useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useShownThreadRouteTarget } from "~/hooks/useShownThreadRouteTarget";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useTots } from "~/state/tots";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { TotAvatar } from "./TotAvatar";
import { useTotAccent } from "./totAccent";

const TotRow = memo(function TotRow(props: {
  readonly entry: EnvironmentTot;
  readonly active: boolean;
}) {
  const { environmentId, tot } = props.entry;
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const accent = useTotAccent(tot.avatar);
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ref = tot.threadId === null ? null : scopeThreadRef(environmentId, tot.threadId);
  const shell = useThreadShell(ref);
  const state = totFaceState(totFaceInputFromShell(tot, shell));
  const open = () => {
    if (ref === null) {
      void navigate({ to: "/settings/tots" });
      return;
    }
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  return (
    <SidebarMenuItem
      data-testid={`sidebar-tot-${tot.id}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {props.active ? (
        <span
          aria-hidden
          data-testid="sidebar-tot-active"
          className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-full"
          style={{ backgroundColor: accent }}
        />
      ) : null}
      <SidebarMenuButton
        aria-label={`${tot.name}, ${STATE_LABELS[state]}`}
        aria-current={props.active ? "page" : undefined}
        isActive={props.active}
        onClick={open}
      >
        <TotAvatar
          avatar={tot.avatar}
          state={state}
          animation={resolveTotAnimation("sidebar-row", animate, reducedMotion)}
          size={20}
          hovered={hovered}
        />
        <span className="min-w-0 flex-1 truncate">{tot.name}</span>
        {state === "needs-you" || state === "failure" ? (
          <span className="text-muted-foreground text-xs">{STATE_LABELS[state]}</span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

/** The user's Tots, above the threads. */
export const TotsSidebarSection = memo(function TotsSidebarSection() {
  const tots = useTots();
  const shown = useShownThreadRouteTarget().shownTarget;
  if (tots.length === 0) return null;
  const shownThread = shown?.kind === "server" ? shown.threadRef : null;
  return (
    <SidebarMenu aria-label="Tots" className="mb-1" data-testid="sidebar-tots">
      {tots.map((entry) => (
        <TotRow
          key={`${entry.environmentId}:${entry.tot.id}`}
          entry={entry}
          active={
            shownThread !== null &&
            entry.tot.threadId !== null &&
            shownThread.environmentId === entry.environmentId &&
            shownThread.threadId === entry.tot.threadId
          }
        />
      ))}
    </SidebarMenu>
  );
});
