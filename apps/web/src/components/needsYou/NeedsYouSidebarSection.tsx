import type { NeedsYouMachine } from "@t3tools/client-runtime/needs-you";
import type { NeedsYouItem } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, Var } from "gt-react";
import { ArrowUpRightIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { memo, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { NEEDS_YOU_KIND_ICONS, NeedsYouItemActions, useOpenNeedsYouItem } from "./NeedsYouPage";
import { useNeedsYou } from "./useNeedsYou";

const SECTION_EXPANDED_KEY = "t3code:sidebar:needs-you-expanded";
const MAX_ROWS = 5;

/** What is waiting on the user, at the top of the sidebar; absent when nothing is. */
export const NeedsYouSidebarSection = memo(function NeedsYouSidebarSection() {
  const inbox = useNeedsYou();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [expanded, setExpanded] = useLocalStorage(SECTION_EXPANDED_KEY, true, Schema.Boolean);
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (inbox.count === 0) return null;
  const entries = inbox.machines.flatMap((machine) =>
    machine.sections.flatMap((section) =>
      section.items.map((item) => ({
        machine,
        item,
        rowKey: `${machine.environmentId}:${item.key}`,
      })),
    ),
  );
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <div className="mt-1 mb-1 border-border/60 border-b pb-1" data-testid="sidebar-needs-you">
      <div className="mx-0.5 mb-1">
        <CollapsibleSectionHeader
          data-testid="sidebar-needs-you-toggle"
          tone="emphasized"
          onClick={() => setExpanded((value) => !value)}
          expanded={expanded}
          accessory={
            <span
              data-testid="sidebar-needs-you-count"
              className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs font-medium leading-none text-primary-foreground tabular-nums"
            >
              {inbox.count > 99 ? "99+" : inbox.count}
            </span>
          }
        >
          <T>Needs you</T>
        </CollapsibleSectionHeader>
      </div>
      {expanded ? (
        <SidebarMenu data-testid="sidebar-needs-you-items">
          {entries.slice(0, MAX_ROWS).map(({ machine, item, rowKey }) => (
            <NeedsYouSidebarRow
              key={rowKey}
              item={item}
              machine={machine}
              open={openKey === rowKey}
              onToggle={() => setOpenKey((current) => (current === rowKey ? null : rowKey))}
              onNavigate={closeMobileSidebar}
            />
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              onClick={() => {
                closeMobileSidebar();
                void navigate({ to: "/needs-you" });
              }}
            >
              <ArrowUpRightIcon className="text-muted-foreground" />
              <span className="text-muted-foreground">
                {entries.length > MAX_ROWS ? (
                  <T>
                    See all <Var>{inbox.count}</Var>
                  </T>
                ) : (
                  <T>Open Needs you</T>
                )}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : null}
    </div>
  );
});

function NeedsYouSidebarRow(props: {
  readonly item: NeedsYouItem;
  readonly machine: NeedsYouMachine;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onNavigate: () => void;
}) {
  const { item, machine } = props;
  const openItem = useOpenNeedsYouItem(machine);
  const Icon = NEEDS_YOU_KIND_ICONS[item.kind];
  return (
    <SidebarMenuItem data-needs-you-row={item.kind}>
      <SidebarMenuButton aria-expanded={props.open} onClick={props.onToggle}>
        <Icon className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
          {item.title} <span className="ms-1 text-xs text-muted-foreground">{item.summary}</span>
        </span>
      </SidebarMenuButton>
      {props.open ? (
        <div className="mx-1 mt-0.5 mb-1.5 flex flex-col gap-2 rounded-md border bg-card p-2 text-xs">
          <p className="line-clamp-4 text-muted-foreground">{item.summary}</p>
          <NeedsYouItemActions item={item} machine={machine} />
          <Button
            size="compact"
            variant="ghost-muted"
            className="self-start"
            onClick={() => {
              props.onNavigate();
              openItem(item);
            }}
          >
            <ArrowUpRightIcon />
            {item.companion !== undefined ? (
              <T>Open companion</T>
            ) : item.threadId === null ? (
              <T>Scheduled tasks</T>
            ) : (
              <T>Open thread</T>
            )}
          </Button>
        </div>
      ) : null}
    </SidebarMenuItem>
  );
}
