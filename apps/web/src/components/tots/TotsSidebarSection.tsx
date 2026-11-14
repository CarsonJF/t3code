import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  TOT_FACE_STATE_LABELS as STATE_LABELS,
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import { useNavigate } from "@tanstack/react-router";
import { HOME_TOT_ID, type TotFaceState } from "@t3tools/contracts";
import type { EnvironmentGroupChat } from "@t3tools/client-runtime/tots";
import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useShownThreadRouteTarget } from "~/hooks/useShownThreadRouteTarget";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useGroupChats, useTots } from "~/state/tots";
import { buildThreadRouteParams } from "../../threadRoutes";
import { readLocalApi } from "../../localApi";
import { toastManager } from "../ui/toast";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { GroupChatAvatar, useGroupChatMembers } from "./GroupChatAvatar";
import { TotAvatar } from "./TotAvatar";
import { useGroupChatActions } from "./useGroupChatActions";
import { useTotAccent } from "./totAccent";
import { useTotActions } from "./useTotActions";

const STATUS_TONE: Partial<Record<TotFaceState, string>> = {
  working: "text-muted-foreground",
  "needs-you": "text-warning-foreground",
  failure: "text-destructive-foreground",
  sleep: "text-muted-foreground/70",
};

/** A Tot's status at a glance: a word for what it is doing, and a filled ping for an unseen reply. */
function TotStatus(props: { readonly state: TotFaceState; readonly accent: string }) {
  if (props.state === "idle") return null;
  if (props.state === "success") {
    return (
      <span
        role="img"
        aria-label="New reply"
        data-testid="sidebar-tot-ping"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: props.accent }}
      />
    );
  }
  return (
    <span className={`shrink-0 text-xs ${STATUS_TONE[props.state] ?? ""}`}>
      {STATE_LABELS[props.state]}
    </span>
  );
}

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
  const toastsOn = useClientSettings((settings) => settings.totToasts);
  const previous = useRef(state);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- raises a toast when a Tot's state changes outside React
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (!toastsOn || props.active || before === state) return;
    if (state !== "success" && state !== "needs-you" && state !== "failure") return;
    const id = toastManager.add({
      type: state === "failure" ? "error" : "info",
      title:
        state === "success"
          ? `${tot.name} replied`
          : state === "needs-you"
            ? `${tot.name} needs you`
            : `${tot.name} hit a problem`,
      ...(ref === null
        ? {}
        : {
            actionProps: {
              children: "Open",
              onClick: () => {
                toastManager.close(id);
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(ref),
                });
              },
            },
          }),
    });
  }, [state, toastsOn, props.active, tot.name, ref, navigate]);
  const actions = useTotActions(environmentId, tot);
  const showMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const running = tot.threadId !== null;
    const items = [
      running ? { id: "open", label: "Open" } : { id: "turn-on", label: "Turn on" },
      { id: "edit", label: "Edit", icon: "settings" },
      { id: "memory", label: "Memory" },
      ...(actions.hasInstructionsFile ? [{ id: "instructions", label: "Instructions" }] : []),
      ...(running
        ? [
            { id: "start-fresh", label: "Start fresh" },
            { id: "turn-off", label: "Turn off" },
          ]
        : []),
      ...(tot.id === HOME_TOT_ID
        ? []
        : [{ id: "delete", label: "Delete", icon: "trash", destructive: true }]),
    ];
    const clicked = await api.contextMenu.show(items, position).catch(() => null);
    switch (clicked) {
      case "open":
        if (tot.threadId !== null) void actions.openThread(tot.threadId);
        break;
      case "turn-on":
        void actions.turnOn();
        break;
      case "edit":
        actions.edit();
        break;
      case "memory":
        actions.openMemory();
        break;
      case "instructions":
        void actions.editInstructions();
        break;
      case "start-fresh":
        void actions.startFresh();
        break;
      case "turn-off":
        void actions.turnOff();
        break;
      case "delete":
        void actions.remove();
        break;
    }
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    void showMenu({ x: event.clientX, y: event.clientY });
  };
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
      onContextMenu={handleContextMenu}
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
        <span
          className={`min-w-0 flex-1 truncate ${state === "sleep" ? "text-muted-foreground" : ""}`}
        >
          {tot.name}
        </span>
        <TotStatus state={state} accent={accent} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

const GroupChatRow = memo(function GroupChatRow(props: {
  readonly entry: EnvironmentGroupChat;
  readonly active: boolean;
}) {
  const { environmentId, room } = props.entry;
  const members = useGroupChatMembers(props.entry);
  const actions = useGroupChatActions(environmentId, room);
  const showMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const clicked = await api.contextMenu
      .show(
        [
          { id: "open", label: "Open" },
          { id: "edit", label: "Edit", icon: "settings" },
          { id: "delete", label: "Delete", icon: "trash", destructive: true },
        ],
        position,
      )
      .catch(() => null);
    if (clicked === "open") actions.open();
    else if (clicked === "edit") actions.edit();
    else if (clicked === "delete") void actions.remove();
  };
  return (
    <SidebarMenuItem
      data-testid={`sidebar-group-chat-${room.id}`}
      onContextMenu={(event: ReactMouseEvent) => {
        event.preventDefault();
        void showMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <SidebarMenuButton
        aria-label={`${room.name}, group chat`}
        aria-current={props.active ? "page" : undefined}
        isActive={props.active}
        onClick={actions.open}
      >
        <GroupChatAvatar members={members} size={20} />
        <span className="min-w-0 flex-1 truncate">{room.name}</span>
        <span className="shrink-0 text-muted-foreground text-xs">{members.length}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

/** The user's Tots and group chats, under the search bar and above drafts and threads. */
export const TotsSidebarSection = memo(function TotsSidebarSection() {
  const tots = useTots();
  const rooms = useGroupChats();
  const shown = useShownThreadRouteTarget().shownTarget;
  if (tots.length === 0 && rooms.length === 0) return null;
  const shownThread = shown?.kind === "server" ? shown.threadRef : null;
  return (
    <div className="mt-1 mb-1 border-border/60 border-b pb-1">
      <SidebarMenu aria-label="Tots" data-testid="sidebar-tots">
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
        {rooms.map((entry) => (
          <GroupChatRow
            key={`${entry.environmentId}:${entry.room.id}`}
            entry={entry}
            active={
              shownThread !== null &&
              entry.room.threadId !== null &&
              shownThread.environmentId === entry.environmentId &&
              shownThread.threadId === entry.room.threadId
            }
          />
        ))}
      </SidebarMenu>
    </div>
  );
});
