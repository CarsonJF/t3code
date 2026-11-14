import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GroupChatService from "./GroupChatService.ts";
import * as TotService from "./TotService.ts";

/** Tot services for tests whose callers are never Tots. */
export const notTotLayer = Layer.merge(
  Layer.mock(TotService.TotService)({
    list: Effect.succeed([]),
    totForThread: () => Effect.succeedNone,
  }),
  Layer.mock(GroupChatService.GroupChatService)({
    list: Effect.succeed([]),
  }),
);
