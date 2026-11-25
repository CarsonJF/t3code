import { TouchBarState } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { createTouchBarController } from "../../window/DesktopTouchBar.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { MENU_ACTION_CHANNEL, SET_TOUCH_BAR_STATE_CHANNEL } from "../channels.ts";

// Electron cannot tell whether this Mac has a Touch Bar; setting one where none exists is a no-op.
export const installTouchBar = Effect.fn("desktop.ipc.installTouchBar")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcess.Platform;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const controller =
    platform === "darwin"
      ? createTouchBarController({
          dispatch: (window, action) => {
            if (!window.isDestroyed()) window.webContents.send(MENU_ACTION_CHANNEL, action);
          },
        })
      : null;
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_TOUCH_BAR_STATE_CHANNEL,
      payload: TouchBarState,
      result: Schema.Void,
      handler: Effect.fn("desktop.ipc.touchBar.set")(function* (state, event) {
        if (!controller) return;
        const main = yield* electronWindow.main;
        // Only the main window shows the focused thread; other app windows keep their own bars.
        if (Option.isNone(main) || main.value.isDestroyed()) return;
        if (event && main.value.webContents.id !== event.sender.id) return;
        yield* Effect.sync(() => controller.update(main.value, state)).pipe(
          Effect.catchDefect((cause) => Effect.logWarning("Could not update the Touch Bar", cause)),
        );
      }),
    }),
  );
  if (controller) yield* Effect.addFinalizer(() => Effect.sync(() => controller.dispose()));
});
