import { EnvironmentId, type ExternalCompanionStatus } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { CompanionChatView } from "./CompanionChatView";

const environmentId = EnvironmentId.make("local");

const companion = {
  id: "yui",
  label: "Yui",
  connection: "connected",
  error: null,
  avatarStates: {},
  manifest: {
    children: [{ id: "scout", name: "Scout" }],
  },
} as unknown as ExternalCompanionStatus;

vi.mock(import("../../state/companions"), () => ({ useCompanion: () => companion }));
// Without a session the composer is disabled, and a disabled textarea cannot take focus.
vi.mock(import("../../state/server"), async (importOriginal) => {
  const original = await importOriginal();
  const sendToCompanion = Object.assign(Object.create(original.serverEnvironment.sendToCompanion), {
    permissionAtom: () => Atom.make(true),
  });
  return {
    ...original,
    serverEnvironment: { ...original.serverEnvironment, sendToCompanion },
  };
});

const composer = (name: string) => document.querySelector(`textarea[aria-label="Message ${name}"]`);

it("focuses the composer on opening a companion and on switching to a child channel", async () => {
  using _frames = fakeTimers();
  await using screen = await render(
    <SidebarProvider>
      <CompanionChatView environmentId={environmentId} companionId="yui" channel="main" />
    </SidebarProvider>,
  );
  await act(() => vi.advanceTimersToNextFrame());
  expect(composer("Yui")).not.toBeNull();
  expect(document.activeElement).toBe(composer("Yui"));

  await screen.rerender(
    <SidebarProvider>
      <CompanionChatView environmentId={environmentId} companionId="yui" channel="child:scout" />
    </SidebarProvider>,
  );
  await act(() => vi.advanceTimersToNextFrame());
  expect(composer("Scout")).not.toBeNull();
  expect(document.activeElement).toBe(composer("Scout"));
});
