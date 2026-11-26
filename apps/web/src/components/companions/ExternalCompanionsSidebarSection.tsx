import { companionChannelId } from "@t3tools/client-runtime/companions";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ChevronRightIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { memo, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useCompanions, type EnvironmentCompanion } from "../../state/companions";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";
import { CompanionFace } from "./CompanionFace";

const SECTION_EXPANDED_KEY = "t3code:sidebar:companions-expanded";
const CHILDREN_EXPANDED_KEY = "t3code:sidebar:companion-children-expanded";
const ExpandedChildren = Schema.Array(Schema.String);

/** `/companions/<environment>/<companion>?channel=<channel>` as the location shows it. */
function companionPath(environmentId: string, companionId: string) {
  return `/companions/${encodeURIComponent(environmentId)}/${encodeURIComponent(companionId)}`;
}

function UnreadCount(props: { readonly count: number }) {
  const gt = useGT();
  if (props.count <= 0) return null;
  return (
    <span
      aria-label={gt("{count, plural, one {{count} unread} other {{count} unread}}", {
        count: props.count,
      })}
      className="shrink-0 rounded-full bg-primary px-1.5 text-3xs font-medium leading-4 tabular-nums text-primary-foreground"
    >
      {props.count > 99 ? "99+" : props.count}
    </span>
  );
}

const CompanionRow = memo(function CompanionRow(props: {
  readonly entry: EnvironmentCompanion;
  readonly activeChannel: string | null;
  readonly childrenOpen: boolean;
  readonly onToggleChildren: () => void;
}) {
  const { environmentId, companion } = props.entry;
  const navigate = useNavigate();
  const gt = useGT();
  const [hovered, setHovered] = useState(false);
  const manifest = companion.manifest;
  const online = companion.connection === "connected";
  const children = manifest?.children ?? [];
  const unread = children.reduce((total, child) => total + child.unreadCount, 0);
  const open = (channel: string) =>
    void navigate({
      to: "/companions/$environmentId/$companionId",
      params: { environmentId, companionId: companion.id },
      search: { channel },
    });
  const status =
    companion.connection === "connected"
      ? gt("Connected")
      : companion.connection === "connecting"
        ? gt("Connecting")
        : gt("Offline");
  return (
    <SidebarMenuItem
      data-testid={`sidebar-companion-${companion.id}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <SidebarMenuButton
        aria-label={`${companion.label}, ${status}`}
        aria-current={props.activeChannel === "main" ? "page" : undefined}
        isActive={props.activeChannel === "main"}
        onClick={() => open("main")}
      >
        <CompanionFace
          avatar={manifest?.avatar}
          seed={companion.id}
          state={companion.avatarStates.main}
          online={online}
          size={20}
          hovered={hovered}
        />
        <span className={cn("min-w-0 flex-1 truncate", !online && "text-muted-foreground")}>
          {companion.label}
        </span>
        {online ? null : (
          <span className="shrink-0 text-xs text-muted-foreground/70">{status}</span>
        )}
        {props.childrenOpen ? null : <UnreadCount count={unread} />}
      </SidebarMenuButton>
      {children.length === 0 ? null : (
        <>
          <button
            type="button"
            aria-expanded={props.childrenOpen}
            data-testid={`sidebar-companion-children-${companion.id}`}
            onClick={props.onToggleChildren}
            className="flex h-6 w-full cursor-pointer items-center gap-1 rounded-md ps-8 pe-2 text-left text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 shrink-0", props.childrenOpen && "rotate-90")}
            />
            <span className="min-w-0 truncate">
              {manifest?.childrenLabel ?? <T context="a companion's sub-agents">Children</T>}
            </span>
            <span className="ms-auto tabular-nums">{children.length}</span>
          </button>
          {props.childrenOpen ? (
            <SidebarMenuSub aria-label={manifest?.childrenLabel ?? gt("Children")}>
              {children.map((child) => {
                const channel = companionChannelId(child.id);
                return (
                  <SidebarMenuSubItem key={child.id}>
                    <SidebarMenuSubButton
                      render={<button type="button" />}
                      data-testid={`sidebar-companion-child-${child.id}`}
                      isActive={props.activeChannel === channel}
                      aria-current={props.activeChannel === channel ? "page" : undefined}
                      onClick={() => open(channel)}
                    >
                      <CompanionFace
                        avatar={child.avatar ?? manifest?.avatar}
                        seed={`${companion.id}:${child.id}`}
                        state={companion.avatarStates[child.id]}
                        online={online}
                        size={16}
                      />
                      <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      <UnreadCount count={child.unreadCount} />
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          ) : null}
        </>
      )}
    </SidebarMenuItem>
  );
});

/** External Companions, apart from Tots: each with its children as sub-channels. */
export const ExternalCompanionsSidebarSection = memo(function ExternalCompanionsSidebarSection() {
  const companions = useCompanions();
  const gt = useGT();
  const location = useLocation();
  const [expanded, setExpanded] = useLocalStorage(SECTION_EXPANDED_KEY, true, Schema.Boolean);
  const [openChildren, setOpenChildren] = useLocalStorage(
    CHILDREN_EXPANDED_KEY,
    [] as ReadonlyArray<string>,
    ExpandedChildren,
  );
  if (companions.length === 0) return null;
  const search = location.search as { readonly channel?: unknown };
  const activeChannel = (entry: EnvironmentCompanion) =>
    location.pathname === companionPath(entry.environmentId, entry.companion.id)
      ? typeof search.channel === "string"
        ? search.channel
        : "main"
      : null;
  const rowKey = (entry: EnvironmentCompanion) => `${entry.environmentId}:${entry.companion.id}`;
  return (
    <div className="mt-1 mb-1 border-border/60 border-b pb-1">
      <div className="mx-0.5 mb-1">
        <CollapsibleSectionHeader
          data-testid="sidebar-companions-toggle"
          onClick={() => setExpanded((value) => !value)}
          expanded={expanded}
          accessory={<span className="font-normal tabular-nums">{companions.length}</span>}
        >
          <T>External Companions</T>
        </CollapsibleSectionHeader>
      </div>
      {expanded ? (
        <SidebarMenu aria-label={gt("External Companions")} data-testid="sidebar-companions">
          {companions.map((entry) => {
            const key = rowKey(entry);
            const childrenOpen = openChildren.includes(key);
            return (
              <CompanionRow
                key={key}
                entry={entry}
                activeChannel={activeChannel(entry)}
                childrenOpen={childrenOpen}
                onToggleChildren={() =>
                  setOpenChildren((current) =>
                    current.includes(key)
                      ? current.filter((item) => item !== key)
                      : [...current, key],
                  )
                }
              />
            );
          })}
        </SidebarMenu>
      ) : null}
    </div>
  );
});
