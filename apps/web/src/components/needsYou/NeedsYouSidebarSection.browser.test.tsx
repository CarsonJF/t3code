import type { MergedNeedsYou, NeedsYouMachine } from "@t3tools/client-runtime/needs-you";
import { EnvironmentId, type NeedsYouItem, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { NeedsYouSidebarSection } from "./NeedsYouSidebarSection";

const SECTION_EXPANDED_KEY = "t3code:sidebar:needs-you-expanded";

let inbox: MergedNeedsYou = { machines: [], count: 0 };

vi.mock(import("./useNeedsYou"), () => ({ useNeedsYou: () => inbox }));

function failedRun(index: number): NeedsYouItem {
  return {
    key: `failed-${index}`,
    kind: "failed_run",
    threadId: ThreadId.make(`thread-${index}`),
    title: `Thread ${index}`,
    summary: `Run ${index} failed`,
    at: "2026-11-26T10:00:00.000Z",
    totId: null,
  };
}

function machine(items: ReadonlyArray<NeedsYouItem>, connected = true): NeedsYouMachine {
  const environmentId = EnvironmentId.make(connected ? "local" : "linked");
  return {
    environmentId,
    label: connected ? "This machine" : "Build box",
    error: null,
    via: EnvironmentId.make("local"),
    connected,
    sections: [{ totId: null, totName: null, companionId: null, items }],
    hidden: [],
  };
}

/** Serves these machines as the inbox until disposed, then clears it and the saved fold. */
function seedInbox(machines: ReadonlyArray<NeedsYouMachine>): Disposable {
  inbox = {
    machines,
    count: machines.reduce(
      (total, entry) =>
        total + entry.sections.reduce((sum, section) => sum + section.items.length, 0),
      0,
    ),
  };
  return {
    [Symbol.dispose]: () => {
      inbox = { machines: [], count: 0 };
      window.localStorage.removeItem(SECTION_EXPANDED_KEY);
    },
  };
}

function Harness() {
  return (
    <SidebarProvider>
      <NeedsYouSidebarSection />
    </SidebarProvider>
  );
}

it("renders nothing when nothing is waiting", async () => {
  using _inbox = seedInbox([]);
  await using screen = await render(<Harness />);
  await expect.element(screen.getByTestId("sidebar-needs-you")).not.toBeInTheDocument();
});

it("lists waiting items under a counted header and stays folded across a remount", async () => {
  using _inbox = seedInbox([machine([failedRun(1), failedRun(2)])]);
  await using first = await render(<Harness />);
  await expect.element(first.getByTestId("sidebar-needs-you-count")).toHaveTextContent("2");
  await expect
    .element(first.getByRole("button", { name: "Thread 1 Run 1 failed" }))
    .toBeInTheDocument();
  await expect
    .element(first.getByRole("button", { name: "Thread 2 Run 2 failed" }))
    .toBeInTheDocument();
  await expect.element(first.getByText("Open Needs you")).toBeInTheDocument();

  await userEvent.click(first.getByTestId("sidebar-needs-you-toggle"));
  await expect.element(first.getByTestId("sidebar-needs-you-items")).not.toBeInTheDocument();
  expect(window.localStorage.getItem(SECTION_EXPANDED_KEY)).toBe("false");

  await first.unmount();
  await using second = await render(<Harness />);
  await expect.element(second.getByTestId("sidebar-needs-you-items")).not.toBeInTheDocument();
  await expect.element(second.getByTestId("sidebar-needs-you-count")).toHaveTextContent("2");
});

it("caps the list and links to the full page", async () => {
  using _inbox = seedInbox([machine([1, 2, 3, 4, 5, 6, 7].map(failedRun))]);
  await using screen = await render(<Harness />);
  expect(screen.container.querySelectorAll("[data-needs-you-row]")).toHaveLength(5);
  await expect.element(screen.getByText("See all 7")).toBeInTheDocument();
});

it("expands an item in place, and says when its machine is not connected", async () => {
  const companion: NeedsYouItem = {
    ...failedRun(1),
    kind: "companion",
    threadId: null,
    title: "Courier",
    summary: "Deliver the note?",
    companion: {
      companionId: "courier",
      name: "Courier",
      needsYouId: "n1",
      channel: "main",
      kind: "approval",
      options: [],
    },
  };
  using _inbox = seedInbox([machine([companion], false)]);
  await using screen = await render(<Harness />);
  const row = screen.getByRole("button", { name: /Courier/ });
  await expect.element(row).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(row);
  await expect.element(row).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText(/to answer its companions here/)).toBeInTheDocument();
  await expect.element(screen.getByText("Open companion")).toBeInTheDocument();
});
