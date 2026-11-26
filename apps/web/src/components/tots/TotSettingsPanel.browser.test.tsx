import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
  type Tot,
  TotId,
  type TotObjective,
  TotObjectiveId,
  totThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ConfirmDialogHost } from "../ConfirmDialogHost";
import { TotSettingsPanel } from "./TotSettingsPanel";

const environmentId = EnvironmentId.make("laptop");
const totId = TotId.make("yui");
const totProjectId = ProjectId.make("project:tot-yui");
const appProjectId = ProjectId.make("project:app");
const totThread = totThreadId(totId, "one");

const tot: Tot = {
  ...DEFAULT_HOME_TOT,
  id: totId,
  name: "Yui",
  projectId: totProjectId,
  threadId: totThread,
};

const state = vi.hoisted(() => ({
  tasks: [] as ReadonlyArray<ScheduledTask>,
  objectives: [] as ReadonlyArray<TotObjective>,
  projects: [] as ReadonlyArray<{ id: string; title: string }>,
  remove: vi.fn(),
  updateWork: vi.fn(),
}));

function setup(tasks: ReadonlyArray<ScheduledTask>) {
  state.tasks = tasks;
  state.projects = [
    { id: totProjectId, title: "Yui's folder" },
    { id: appProjectId, title: "T3 Code" },
  ];
  state.remove.mockReset().mockResolvedValue({ _tag: "Success", value: { id: "deleted" } });
  state.objectives = [];
  state.updateWork.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
}

function scheduledTask(
  id: string,
  overrides: Partial<ScheduledTask> & Pick<ScheduledTask, "schedule">,
): ScheduledTask {
  return {
    id: ScheduledTaskId.make(id),
    title: id,
    prompt: "Do the thing",
    enabled: true,
    projectId: appProjectId,
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "agent",
    creationSource: "mcp",
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
    ...overrides,
  };
}

const finishedOnce = scheduledTask("finished-once", {
  title: "Finished reminder",
  schedule: { type: "once", runAt: "2026-11-16T09:00:00.000Z" },
  createdByTotId: totId,
  lastRunAt: "2026-11-16T09:00:01.000Z",
  lastRunStatus: "failed",
});

const recurring = scheduledTask("recurring", {
  title: "Recurring check",
  schedule: { type: "interval", everyMs: 3_600_000 },
  createdByTotId: totId,
  lastRunAt: "2026-11-16T09:00:01.000Z",
  nextRunAt: "2026-11-17T09:00:00.000Z",
});

const webhook = scheduledTask("webhook", {
  title: "Webhook listener",
  schedule: { type: "webhook", signature: null },
  createdByTotId: totId,
  lastRunAt: "2026-11-16T09:00:01.000Z",
});

const anotherProjectTask = scheduledTask("another-project", {
  title: "Reminder in another project",
  schedule: { type: "interval", everyMs: 3_600_000 },
  createdByTotId: totId,
  nextRunAt: "2026-11-17T09:00:00.000Z",
});

const unlistedProjectTask = scheduledTask("unlisted-project", {
  title: "Task in an unknown project",
  schedule: { type: "interval", everyMs: 3_600_000 },
  projectId: ProjectId.make("project:ghost"),
  createdByTotId: totId,
});

const anotherTotsTask = scheduledTask("another-tot", {
  title: "Someone else's reminder",
  schedule: { type: "once", runAt: "2026-11-16T09:00:00.000Z" },
  projectId: ProjectId.make("project:unrelated"),
  lastRunAt: "2026-11-16T09:00:01.000Z",
  lastRunStatus: "succeeded",
});

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((_id: EnvironmentId, selector: (settings: unknown) => unknown) =>
    selector({ tots: [tot] })) as never,
}));

vi.mock(import("~/state/tots"), async (original) => ({
  ...(await original()),
  useTots: () => [{ environmentId, tot }],
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() =>
    state.projects.map((project) => ({
      ...project,
      environmentId,
      id: project.id as never,
    }))) as never,
  useThreadShell: () => null,
  useQuietThreadShell: () => null,
}));

vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: { tasks: state.tasks, timeZone: "UTC", objectives: state.objectives },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: vi.fn(),
  })) as never,
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      deleteScheduledTask: { ...actual.serverEnvironment.deleteScheduledTask, run: state.remove },
      setScheduledTaskEnabled: {
        ...actual.serverEnvironment.setScheduledTaskEnabled,
        permissionAtom: () => allowed,
      },
      updateTot: { ...actual.serverEnvironment.updateTot, permissionAtom: () => allowed },
      updateTotWork: {
        ...actual.serverEnvironment.updateTotWork,
        run: state.updateWork,
        permissionAtom: () => allowed,
      },
      enableTot: { ...actual.serverEnvironment.enableTot, permissionAtom: () => allowed },
      disableTot: { ...actual.serverEnvironment.disableTot, permissionAtom: () => allowed },
    },
  };
});

function Panel() {
  return (
    <>
      <TotSettingsPanel
        environmentId={environmentId}
        threadRef={{ environmentId, threadId: totThread }}
      />
      <ConfirmDialogHost />
    </>
  );
}

describe("TotSettingsPanel scheduled tasks", () => {
  it("shows the tasks a Tot made in other projects, with where each lives", async () => {
    setup([anotherProjectTask, unlistedProjectTask, anotherTotsTask]);
    await using screen = await render(<Panel />);

    await expect.element(screen.getByText("Reminder in another project")).toBeInTheDocument();
    await expect.element(screen.getByText("T3 Code")).toBeInTheDocument();
    await expect.element(screen.getByText("Task in an unknown project")).toBeInTheDocument();
    await expect.element(screen.getByText(/another project ·/)).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("Someone else's reminder");
  });

  it("shows the empty state only when the Tot has no tasks", async () => {
    setup([anotherTotsTask]);
    await using screen = await render(<Panel />);

    await expect
      .element(screen.getByText(/No scheduled tasks for this Tot\. Ask Yui to make one\./))
      .toBeInTheDocument();
  });

  it("clears only the finished one-off tasks after a confirm", async () => {
    setup([finishedOnce, recurring, webhook, anotherTotsTask]);
    await using screen = await render(<Panel />);

    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect.element(page.getByText(/Delete 1 finished one-off task\?/)).toBeVisible();
    expect(state.remove).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
    expect(state.remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    await userEvent.click(page.getByRole("button", { name: "Confirm", exact: true }));
    await vi.waitFor(() =>
      expect(state.remove).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        environmentId,
        input: { id: finishedOnce.id },
      }),
    );
    await expect.element(screen.getByText("Recurring check")).toBeInTheDocument();
    await expect.element(screen.getByText("Webhook listener")).toBeInTheDocument();
  });
});

const objective = (
  id: string,
  overrides: Partial<TotObjective> & Pick<TotObjective, "title" | "status">,
): TotObjective => ({
  id: TotObjectiveId.make(id),
  totId,
  failedAttempts: 0,
  retryCap: 3,
  attempts: [],
  createdAt: "2026-11-25T09:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  ...overrides,
});

const failedAttempt = (index: number) => ({
  id: `att-${index}`,
  kind: "launch" as const,
  environmentId,
  threadId: totThreadId(totId, `worker-${index}`),
  runId: null,
  taskId: null,
  status: "failed" as const,
  outcome: index === 3 ? "CI still red: flaky e2e test." : null,
  startedAt: "2026-11-25T09:00:00.000Z",
  endedAt: "2026-11-25T09:30:00.000Z",
});

describe("TotSettingsPanel work", () => {
  it("lists objectives by status, and a capped one can be reset", async () => {
    setup([]);
    state.objectives = [
      objective("obj-done000001", { title: "Ship the docs", status: "done" }),
      objective("obj-capped0001", {
        title: "Repair CI",
        status: "needs_you",
        failedAttempts: 3,
        attempts: [1, 2, 3].map(failedAttempt),
      }),
    ];
    await using screen = await render(<Panel />);

    await expect.element(screen.getByText("Needs you · 1")).toBeInTheDocument();
    await expect.element(screen.getByText("Done · 1")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/3 attempts · 3 failed, the limit is 3/))
      .toBeInTheDocument();
    await expect.element(screen.getByText("CI still red: flaky e2e test.")).toBeInTheDocument();
    const text = screen.container.textContent ?? "";
    expect(text.indexOf("Repair CI")).toBeLessThan(text.indexOf("Ship the docs"));

    await userEvent.click(screen.getByRole("button", { name: "Reset attempts" }));
    await vi.waitFor(() =>
      expect(state.updateWork).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        environmentId,
        input: { id: totId, objectiveId: "obj-capped0001", action: "reset" },
      }),
    );
  });

  it("says so when the Tot has no objectives yet", async () => {
    setup([]);
    await using screen = await render(<Panel />);
    await expect
      .element(screen.getByText(/Nothing yet\. Work Yui launches with an objective shows here\./))
      .toBeInTheDocument();
  });
});
