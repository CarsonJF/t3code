import { useAtomValue } from "@effect/atom-react";
import { mergeNeedsYou, type MergedNeedsYou } from "@t3tools/client-runtime/needs-you";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";

import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { serverEnvironment } from "../../state/server";

const needsYouAtoms = environmentAtomList("web-needs-you", (environmentId) =>
  serverEnvironment.needsYouLive({ environmentId, input: { includeHidden: true } }),
);

/** Every connected environment's inbox, linked ones included, as one. */
export function useNeedsYou(): MergedNeedsYou {
  const connected = useConnectedEnvironmentIds();
  const results = useAtomValue(needsYouAtoms(environmentIdsKey(connected)));
  const sources = connected.flatMap((sourceEnvironmentId, index) => {
    const result = results[index];
    const inbox =
      result === undefined ? undefined : Option.getOrUndefined(AsyncResult.value(result));
    return inbox === undefined ? [] : [{ sourceEnvironmentId, inbox }];
  });
  return mergeNeedsYou(sources, new Set(connected));
}
