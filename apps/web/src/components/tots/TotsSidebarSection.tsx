import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import type { TotFaceState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { memo, useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useTots } from "~/state/tots";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { TotAvatar } from "./TotAvatar";

const STATE_LABELS: Record<TotFaceState, string> = {
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
  success: "Done",
  failure: "Failed",
  sleep: "Off",
};

const TotRow = memo(function TotRow(props: { readonly entry: EnvironmentTot }) {
  const { environmentId, tot } = props.entry;
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
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
      <SidebarMenuButton aria-label={`${tot.name}, ${STATE_LABELS[state]}`} onClick={open}>
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
  if (tots.length === 0) return null;
  return (
    <SidebarMenu aria-label="Tots" className="mb-1" data-testid="sidebar-tots">
      {tots.map((entry) => (
        <TotRow key={`${entry.environmentId}:${entry.tot.id}`} entry={entry} />
      ))}
    </SidebarMenu>
  );
});
