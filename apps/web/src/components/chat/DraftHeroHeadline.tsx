import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { buildProjectPickerSections } from "@t3tools/client-runtime/thread-groups";
import { T, useGT, Var } from "gt-react";
import { FolderPlusIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useOrderWhileOpen, useValueWhileOpen } from "~/hooks/useOrderWhileOpen";
import { moveDraftToProject } from "~/lib/moveDraftToProject";
import { useProjectPin } from "~/hooks/useProjectGroupUpdate";
import { useScratchProject } from "~/hooks/useScratchProject";
import { isTriagePrompt } from "@t3tools/shared/triagePrompt";
import { useClientSettings } from "~/hooks/useSettings";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import {
  buildSidebarProjectPickerEntries,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useVisibleThreadShells } from "~/state/entities";
import { usePickableProjects } from "~/state/tots";
import { useThreadGroupsStore } from "~/threadGroupsStore";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { isProjectPinShortcut, ProjectPinButton } from "../ProjectPinButton";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import { useSortedProjectGroups } from "../CommandPaletteLookups";
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipScrollDismissArea, TooltipTrigger } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { DraftProjectName } from "./DraftProjectName";
import { DraftHeroProjectHeading } from "./DraftHeroProjectHeading";
import { TriageDraftHero } from "./TriageDraftHero";

const ADD_PROJECT_VALUE = "add-project";

interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly projectKey: string | null;
}

type PickerGroup = {
  readonly value: string;
  readonly label: string | null;
  readonly items: readonly PickerItem[];
};

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const gt = useGT();
  const projects = usePickableProjects();
  const threads = useVisibleThreadShells();
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  // A boolean, so typing in a draft does not re-render the hero.
  const isTriageDraftPrompt = useComposerDraftStore((store) =>
    draftId ? isTriagePrompt(store.getComposerDraft(draftId)?.prompt ?? "") : false,
  );
  const openAddProject = () => openCommandPalette({ open: "add-project", draftId });
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const openProjectDraft = useNewThreadHandler();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerFilter = useComboboxFilter();
  const highlightedPickerValueRef = useRef<string | null>(null);
  const { canPinProjectGroup, toggleProjectGroupPin } = useProjectPin();
  const threadGroups = useThreadGroupsStore();

  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectGroups = useSortedProjectGroups(environmentLabelById);
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const environmentMachineById = new Map(
    environments.map(
      (environment) =>
        [
          environment.environmentId,
          resolveEnvironmentMachineKind(environment.serverConfig),
        ] as const,
    ),
  );
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: pickableProjectGroups(projectGroups),
    preferredProjectRef: activeProjectRef,
  });
  const projectEntryByKey = new Map(
    projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const),
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
  );
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(activeProjectRef?.environmentId ?? null);
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null &&
    isScratchProject(activeProject, scratchWorkspaceRootFor(activeProject.environmentId));

  // Pinning from a row keeps rows in place, and in their section, while the picker is open.
  const menuKeys = new Set(menuEntries.map(({ group }) => group.projectKey));
  const menuGroups = useOrderWhileOpen(
    projectGroups.filter((group) => menuKeys.has(group.projectKey)),
    (group) => group.projectKey,
    pickerOpen,
  );
  const placement = useValueWhileOpen(
    {
      pinnedKeys: new Set(menuGroups.flatMap((group) => (group.pinned ? [group.projectKey] : []))),
      mostRecentKey:
        menuGroups.length < 2
          ? null
          : (projectSortOrder === "updated_at"
              ? menuGroups
              : sortLogicalProjectsForSidebar(menuGroups, threads, "updated_at"))[0]!.projectKey,
    },
    pickerOpen,
  );
  const projectItem = (group: (typeof menuGroups)[number], value?: string) => ({
    value: value ?? group.projectKey,
    label: group.displayName,
    projectKey: group.projectKey,
  });
  const pickerGroups: readonly PickerGroup[] = [
    ...buildProjectPickerSections({
      projects: menuGroups,
      mostRecent: menuGroups.find((group) => group.projectKey === placement.mostRecentKey) ?? null,
      isPinned: (group) => placement.pinnedKeys.has(group.projectKey),
      projectRefs: (group) => group.memberProjectRefs,
      byEnvironment: threadGroups.byEnvironment,
      groups: threadGroups.groups,
    }).map((section) => ({
      value: section.key,
      label: section.label,
      items: section.projects.map((group) =>
        projectItem(group, section.key === "recent" ? `recent:${group.projectKey}` : undefined),
      ),
    })),
    {
      value: "actions",
      label: null,
      items: [{ value: ADD_PROJECT_VALUE, label: gt("Add project"), projectKey: null }],
    },
  ];
  const pickerSearch = pickerQuery.trim();
  const matchingItems = menuGroups
    .map((group) => projectItem(group))
    .filter((item) => pickerFilter.contains(item, pickerSearch, (candidate) => candidate.label));
  const filteredPickerGroups: readonly PickerGroup[] =
    pickerSearch.length === 0
      ? pickerGroups
      : matchingItems.length === 0
        ? []
        : [{ value: "search", label: null, items: matchingItems }];
  const activeMenuGroup = menuGroups.find((group) => group.projectKey === activeProjectKey);
  const selectedPickerItem = activeMenuGroup ? projectItem(activeMenuGroup) : null;

  // The picker can change the draft's target while the no-project home is
  // still being opened; a stale continuation must not retarget it again. Picking
  // a project clears the pending request, and the draft session is compared
  // against the store when the scratch project arrives.
  const pendingScratchRef = useRef<symbol | null>(null);
  const draftTargetKey = () => {
    const session = draftId ? useComposerDraftStore.getState().getDraftSession(draftId) : null;
    return session
      ? `${session.environmentId}:${session.projectId}:${session.logicalProjectKey}`
      : null;
  };
  const selectProject = (project: (typeof projects)[number]) => {
    if (!draftId) {
      return;
    }
    pendingScratchRef.current = null;
    if (!moveDraftToProject(draftId, project)) {
      void openProjectDraft(scopeProjectRef(project.environmentId, project.id));
    }
  };
  const startScratch = async (): Promise<boolean> => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) {
      return false;
    }
    const request = Symbol("scratch");
    pendingScratchRef.current = request;
    const requestedTarget = draftTargetKey();
    const project = await openScratchProject(scratchTargetEnvironmentId);
    if (!project || pendingScratchRef.current !== request || draftTargetKey() !== requestedTarget) {
      return false;
    }
    pendingScratchRef.current = null;
    selectProject(project);
    return true;
  };

  const renderPickerItem = (item: PickerItem) => {
    const entry = item.projectKey === null ? null : projectEntryByKey.get(item.projectKey);
    return (
      <ComboboxItem key={item.value} hideIndicator value={item}>
        {item.value === ADD_PROJECT_VALUE ? (
          <FolderPlusIcon className="size-4 shrink-0" />
        ) : entry ? (
          <ProjectFavicon project={entry.group} className="size-4 shrink-0" />
        ) : null}
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 flex-1 text-sm" />}>
            <DraftProjectName value={item.label} />
          </TooltipTrigger>
          <TooltipPopup side="top">{item.label}</TooltipPopup>
        </Tooltip>
        {entry && canPinProjectGroup(entry.group) ? (
          <ProjectPinButton
            name={entry.group.displayName}
            pinned={entry.group.pinned}
            shortcutLabel={shortcutLabelForCommand(keybindings, "thread.pin")}
            onToggle={() => toggleProjectGroupPin(entry.group)}
          />
        ) : null}
        {entry && showProjectEnvironments ? (
          <ProjectEnvironmentBadge
            group={entry.group}
            primaryEnvironmentId={primaryEnvironmentId}
            machineByEnvironmentId={environmentMachineById}
          />
        ) : null}
      </ComboboxItem>
    );
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Combobox
      items={pickerGroups}
      filteredItems={filteredPickerGroups}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={pickerOpen}
      onItemHighlighted={(item) => {
        highlightedPickerValueRef.current = item?.projectKey ?? null;
      }}
      onOpenChange={(open) => {
        setPickerOpen(open);
        setPickerQuery("");
      }}
      value={selectedPickerItem}
      onValueChange={(item) => {
        if (!item) return;
        setPickerOpen(false);
        if (item.value === ADD_PROJECT_VALUE) {
          openAddProject();
          return;
        }
        const entry = item.projectKey === null ? null : projectEntryByKey.get(item.projectKey);
        if (!entry || item.projectKey === activeProjectKey) {
          return;
        }
        selectProject(entry.targetProject);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<InlineButton tone="picker" />}
              data-draft-project-trigger=""
              className="pointer-events-auto min-w-0 max-w-full align-baseline"
            />
          }
        >
          <DraftProjectName
            value={
              isScratchDraft ? gt("No project") : (activeProjectTitle ?? gt("Choose a project"))
            }
            singleLine
          />
        </TooltipTrigger>
        {activeProjectTitle && !isScratchDraft ? (
          <TooltipPopup side="top">{activeProjectTitle}</TooltipPopup>
        ) : null}
      </Tooltip>
      <ComboboxPopup
        align="center"
        className="w-72 overflow-hidden"
        render={<TooltipScrollDismissArea holdPositionOnExit />}
      >
        <ComboboxSearchInput
          aria-label={gt("Search projects")}
          placeholder={gt("Search projects...")}
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
          onKeyDown={(event) => {
            const highlighted = highlightedPickerValueRef.current;
            const group = highlighted ? projectEntryByKey.get(highlighted)?.group : undefined;
            if (!group || !canPinProjectGroup(group) || !isProjectPinShortcut(event, keybindings)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            toggleProjectGroupPin(group);
          }}
        />
        <ComboboxEmpty>
          <T>No matching projects.</T>
        </ComboboxEmpty>
        <ComboboxList>
          {(group: PickerGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              {group.label ? <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel> : null}
              <ComboboxCollection>{renderPickerItem}</ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline min-w-0 max-w-full cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <DraftProjectName value={activeProjectTitle ?? gt("Add a project")} singleLine />
    </button>
  );

  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");
  const orStartWithoutProject =
    scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              tone="muted"
              className="pointer-events-auto"
              onClick={() =>
                void startScratch().then((started) => {
                  if (started) {
                    document.querySelector<HTMLElement>("[data-draft-project-trigger]")?.focus();
                  }
                })
              }
            />
          }
        >
          <T>or start without a project</T>
        </TooltipTrigger>
        {noProjectShortcut ? <TooltipPopup side="bottom">{noProjectShortcut}</TooltipPopup> : null}
      </Tooltip>
    ) : null;

  if (isScratchDraft && isTriageDraftPrompt) {
    const environment = environments.find(
      (entry) => entry.environmentId === activeProject.environmentId,
    );
    return (
      <TriageDraftHero
        machineLabel={environment?.label ?? null}
        serverVersion={environment?.serverConfig?.environment.serverVersion ?? null}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      {hasResolvedProject && !isScratchDraft ? (
        <DraftHeroProjectHeading projectName={activeProjectTitle ?? gt("Choose a project")}>
          {projectSelector}
        </DraftHeroProjectHeading>
      ) : (
        <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
          {isScratchDraft ? (
            <T>What should we work on?</T>
          ) : canChooseProject ? (
            <T>
              <Var>{projectSelector}</Var> to start
            </T>
          ) : (
            <T>Add a project to start</T>
          )}
        </h1>
      )}
      {scratchWorkspaceRoot === null ? null : (
        <p className="mt-2 flex h-6 w-full items-center justify-center text-sm">
          {isScratchDraft ? projectSelector : orStartWithoutProject}
        </p>
      )}
    </div>
  );
}
