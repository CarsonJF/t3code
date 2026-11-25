import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { setAvatarLibrary } from "./avatarLibraryStore";

/**
 * Reads the avatar library of each environment again whenever `revision` changes, such as when
 * its Tots change or the face editor opens, so a figure an agent just saved can be drawn.
 */
export function useAvatarLibrarySync(
  environmentIds: ReadonlyArray<EnvironmentId>,
  revision: string,
) {
  const read = useAtomCommand(serverEnvironment.readAvatarLibrary, { reportFailure: false });
  // One string, so the effect reruns for a new environment list or a new revision alone.
  const request = `${revision}\u0000${[...new Set(environmentIds)].join("\n")}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads library files from each environment's server
  useEffect(() => {
    const ids = request.slice(request.indexOf("\u0000") + 1);
    if (ids === "") return;
    for (const environmentId of ids.split("\n") as EnvironmentId[]) {
      void read({ environmentId, input: {} }).then((result) => {
        if (result._tag === "Success") setAvatarLibrary(environmentId, result.value);
      });
    }
  }, [read, request]);
}
