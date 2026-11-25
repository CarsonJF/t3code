import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TouchBarState } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import { getClientSettings, subscribeClientSettings } from "../hooks/useSettings";
import { subscribeI18n } from "../i18n/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { registerMenuAction } from "../shortcuts/dispatcher";
import { environmentPresentations } from "../state/presentation";
import { environmentThreadShells } from "../state/threads";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../threadRoutes";
import { cssColorToHex } from "./cssColor";
import {
  collectTouchBarProviders,
  touchBarThreadDriver,
  touchBarThreadStatus,
} from "./touchBarState";

function readOpenThreadRef(router: AnyRouter): ScopedThreadRef | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  return resolveActiveThreadRouteRef(target, draft);
}

/**
 * Sends the desktop main process what its Touch Bar draws: the Limits page's pools and the open
 * thread's provider. Limits arrive with each provider refresh, so this adds no fetching.
 */
export function startTouchBarSync(router: AnyRouter): void {
  const bridge = window.desktopBridge;
  if (bridge?.getClientPlatform() !== "darwin" || !bridge.setTouchBarState) return;
  const send = bridge.setTouchBarState;

  let openThreadRef = readOpenThreadRef(router);
  let lastUsedDriver: string | null = null;
  let sent: string | null = null;

  const write = () => {
    const settings = getClientSettings().touchBar;
    const presentations = appAtomRegistry.get(
      environmentPresentations.presentationsWithProvidersAtom,
    );
    const thread =
      openThreadRef === null
        ? null
        : appAtomRegistry.get(environmentThreadShells.quietThreadShellAtom(openThreadRef));
    const focusedDriver = touchBarThreadDriver(thread, presentations);
    if (focusedDriver !== null) lastUsedDriver = focusedDriver;
    const state: TouchBarState = {
      settings,
      providers: settings.enabled ? collectTouchBarProviders(presentations, Date.now()) : [],
      focusedDriver,
      lastUsedDriver,
      threadStatus: touchBarThreadStatus(thread),
      accentColor: settings.matchThemeAccent ? cssColorToHex("var(--primary)") : null,
      locale: (document.documentElement.lang || navigator.language).slice(0, 35),
    };
    const key = JSON.stringify(state);
    if (key === sent) return;
    sent = key;
    void send(state).catch(() => {
      sent = null;
    });
  };

  let unsubscribeOpenThread = () => {};
  const watchOpenThread = () => {
    unsubscribeOpenThread();
    unsubscribeOpenThread =
      openThreadRef === null
        ? () => {}
        : appAtomRegistry.subscribe(
            environmentThreadShells.quietThreadShellAtom(openThreadRef),
            write,
          );
  };
  const updateOpenThread = () => {
    const next = readOpenThreadRef(router);
    if ((next && scopedThreadKey(next)) === (openThreadRef && scopedThreadKey(openThreadRef))) {
      return;
    }
    openThreadRef = next;
    watchOpenThread();
    write();
  };

  watchOpenThread();
  appAtomRegistry.subscribe(environmentPresentations.presentationsWithProvidersAtom, write, {
    immediate: true,
  });
  subscribeClientSettings(write);
  subscribeI18n(write);
  router.subscribe("onResolved", updateOpenThread);
  useComposerDraftStore.subscribe(updateOpenThread);

  registerMenuAction("touchBar.openLimits", () => {
    if (router.state.location.pathname !== "/usage") void router.navigate({ to: "/usage" });
  });
}
