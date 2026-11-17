import type { EnvironmentTot } from "@t3tools/client-runtime/tots";
import { DEFAULT_HOME_TOT, EnvironmentId, type Tot } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useUiStateStore } from "../../uiStateStore";
import { SidebarProvider } from "../ui/sidebar";
import { TotsSidebarSection } from "./TotsSidebarSection";

const SECTION_EXPANDED_KEY = "t3code:sidebar:tots-expanded";

let fixtures: ReadonlyArray<EnvironmentTot> = [];

vi.mock(import("~/state/tots"), async (original) => ({
  ...(await original()),
  useTots: () => fixtures,
  useGroupChats: () => [],
}));

function setup(tots: ReadonlyArray<EnvironmentTot> = []): void {
  fixtures = tots;
}

function entry(id: string): EnvironmentTot {
  return {
    environmentId: EnvironmentId.make("local"),
    tot: { ...DEFAULT_HOME_TOT, id: id as Tot["id"], name: id },
  };
}

function Harness() {
  return (
    <SidebarProvider>
      <TotsSidebarSection />
    </SidebarProvider>
  );
}

function drag(source: HTMLElement, target: HTMLElement, edge: "before" | "after") {
  const dataTransfer = new DataTransfer();
  const rect = target.getBoundingClientRect();
  const clientY = edge === "before" ? rect.top - 1 : rect.bottom + 1;
  source.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, composed: true, dataTransfer }),
  );
  target.dispatchEvent(
    new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
      clientY,
    }),
  );
  target.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
      clientY,
    }),
  );
  source.dispatchEvent(
    new DragEvent("dragend", { bubbles: true, cancelable: true, composed: true, dataTransfer }),
  );
}

function renderedOrder(container: HTMLElement): ReadonlyArray<string | undefined> {
  return [...container.querySelectorAll<HTMLElement>('[data-testid^="sidebar-tot-"]')].map(
    (row) => row.dataset.testid,
  );
}

it("keeps the Tots section collapsed across a remount and keeps its count", async () => {
  setup([entry("alpha"), entry("beta")]);
  using cleanup = new DisposableStack();
  const previousOrder = useUiStateStore.getState().totOrder;
  cleanup.defer(() => {
    window.localStorage.removeItem(SECTION_EXPANDED_KEY);
    useUiStateStore.setState({ totOrder: previousOrder });
  });

  await using first = await render(<Harness />);
  const toggle = first.getByTestId("sidebar-tots-toggle");
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.element(first.getByTestId("sidebar-tots")).toBeInTheDocument();

  await userEvent.click(toggle);
  await expect.element(first.getByTestId("sidebar-tots")).not.toBeInTheDocument();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.element(first.getByTestId("sidebar-tots-count")).toHaveTextContent("2");
  expect(window.localStorage.getItem(SECTION_EXPANDED_KEY)).toBe("false");

  await first.unmount();
  await using second = await render(<Harness />);
  await expect.element(second.getByTestId("sidebar-tots")).not.toBeInTheDocument();
  await expect.element(second.getByTestId("sidebar-tots-count")).toHaveTextContent("2");
});

it("reorders Tots by dragging a row onto another row's edge", async () => {
  setup([entry("alpha"), entry("beta"), entry("gamma")]);
  using cleanup = new DisposableStack();
  const previousOrder = useUiStateStore.getState().totOrder;
  cleanup.defer(() => {
    window.localStorage.removeItem(SECTION_EXPANDED_KEY);
    useUiStateStore.setState({ totOrder: previousOrder });
  });

  await using screen = await render(<Harness />);
  expect(renderedOrder(screen.container)).toEqual([
    "sidebar-tot-alpha",
    "sidebar-tot-beta",
    "sidebar-tot-gamma",
  ]);

  drag(
    screen.container.querySelector<HTMLElement>('[data-testid="sidebar-tot-alpha"]')!,
    screen.container.querySelector<HTMLElement>('[data-testid="sidebar-tot-gamma"]')!,
    "after",
  );

  await vi.waitFor(() =>
    expect(renderedOrder(screen.container)).toEqual([
      "sidebar-tot-beta",
      "sidebar-tot-gamma",
      "sidebar-tot-alpha",
    ]),
  );
  expect(useUiStateStore.getState().totOrder).toEqual(["local:beta", "local:gamma", "local:alpha"]);
});
