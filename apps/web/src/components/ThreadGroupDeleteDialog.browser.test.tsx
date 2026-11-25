import { EnvironmentId, ProjectId, ThreadId, type ThreadGroupsState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { readEnvironment, readPrimaryEnvironmentId } from "../state/environments";
import { readThreadGroupsView, threadGroupActions } from "../threadGroupsStore";
import { confirmAndDeleteThreadGroup } from "./sidebar/SidebarThreadGroupHeader";
import { ThreadGroupDeleteDialogHost } from "./ThreadGroupDeleteDialog";
import { toastManager } from "./ui/toast";

vi.mock("../state/environments", { spy: true });
vi.mock("../threadGroupsStore", { spy: true });

const desktop = EnvironmentId.make("environment:desktop");
const server = EnvironmentId.make("environment:server");
const games = { id: "games", name: "Games" };
const state: ThreadGroupsState = {
  groups: [games],
  projectDefaults: {
    [ProjectId.make("project-1")]: [{ groupId: "games", since: "2026-11-01T00:00:00.000Z" }],
  },
  threadOverrides: { [ThreadId.make("thread-1")]: "games" },
};

function arrange() {
  const byEnvironment = new Map([
    [server, state],
    [desktop, state],
  ]);
  vi.mocked(readThreadGroupsView).mockReturnValue({ byEnvironment, groups: [games] });
  vi.mocked(readPrimaryEnvironmentId).mockReturnValue(desktop);
  vi.mocked(readEnvironment).mockImplementation(
    (environmentId) =>
      ({ label: environmentId === desktop ? "carson11" : "Asuna" }) as ReturnType<
        typeof readEnvironment
      >,
  );
  const restores = [
    {
      environmentId: desktop,
      op: {
        type: "restoreGroup" as const,
        group: games,
        index: 0,
        projectDefaults: {},
        threadIds: [],
      },
    },
  ];
  const remove = vi.spyOn(threadGroupActions, "delete").mockReturnValue(restores);
  const restore = vi.spyOn(threadGroupActions, "restore").mockImplementation(() => {});
  const toast = vi.spyOn(toastManager, "add");
  return { remove, restore, toast, restores };
}

describe("deleting a thread group", () => {
  it("names the group, its contents and the machine, and removes it only there", async () => {
    const { remove, restore, toast, restores } = arrange();
    await using _screen = await render(<ThreadGroupDeleteDialogHost />, { router: false });

    const done = confirmAndDeleteThreadGroup(games, 3);
    await expect.element(page.getByText('Delete group "Games"?')).toBeInTheDocument();
    await expect
      .element(page.getByText("It holds 2 projects and 3 threads.", { exact: false }))
      .toBeInTheDocument();
    await expect
      .element(page.getByTestId("thread-group-delete-targets"))
      .toHaveTextContent("Removes it from carson11.");
    await userEvent.click(page.getByRole("button", { name: "Delete" }));
    await done;

    expect(remove).toHaveBeenCalledWith("games", [desktop]);
    const added = toast.mock.lastCall![0];
    expect(added.title).toBe('Deleted group "Games"');
    (added.actionProps as { onClick: () => void }).onClick();
    expect(restore).toHaveBeenCalledWith(restores);
  });

  it("removes it from every machine when All machines is ticked", async () => {
    const { remove } = arrange();
    await using _screen = await render(<ThreadGroupDeleteDialogHost />, { router: false });

    const done = confirmAndDeleteThreadGroup(games, 1);
    await userEvent.click(page.getByRole("checkbox"));
    await expect
      .element(page.getByTestId("thread-group-delete-targets"))
      .toHaveTextContent("Removes it from carson11, Asuna.");
    await userEvent.click(page.getByRole("button", { name: "Delete" }));
    await done;

    expect(remove).toHaveBeenCalledWith("games", [desktop, server]);
  });

  it("deletes nothing when cancelled", async () => {
    const { remove } = arrange();
    await using _screen = await render(<ThreadGroupDeleteDialogHost />, { router: false });

    const done = confirmAndDeleteThreadGroup(games, 1);
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await done;

    expect(remove).not.toHaveBeenCalled();
  });
});
