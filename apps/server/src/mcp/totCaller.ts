import {
  type EnvironmentId,
  OrchestratorMcpFailure,
  parseTotThreadId,
  type ThreadId,
  type TotId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as TotService from "../tots/TotService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { assertFullAccess, assertLiveCaller, readCaller } from "./threadAccess.ts";

export interface TotCaller {
  readonly totId: TotId;
  readonly name: string;
  /** `linked`: a Tot on another environment calling through a peer link. */
  readonly via: "local" | "linked";
}

/**
 * The Tot making this call, if any. Here, the grant is "this thread is a Tot's
 * current thread", read on every call. From another environment it is the
 * `T3-Sender-Thread` a full-access peer link forwards: a full-access link is
 * not fenced anyway, so its sender can be taken at its word; a narrower one is not.
 */
// Untraced: read on every T3 tool call, which already has its own span.
export const readTotCaller = Effect.fnUntraced(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!scope.capabilities.has("orchestration")) return Option.none<TotCaller>();
  if (scope.thread !== undefined) {
    const tot = yield* (yield* TotService.TotService).totForThread(scope.thread.threadId);
    return Option.map(tot, (current): TotCaller => ({
      totId: current.id,
      name: current.name,
      via: "local",
    }));
  }
  const client = scope.client;
  if (client?.linked !== true || client.access !== "full-access") return Option.none<TotCaller>();
  const sender = client.senderThread;
  const totId = sender === undefined ? null : parseTotThreadId(sender.threadId);
  if (sender === undefined || totId === null) return Option.none<TotCaller>();
  return Option.some<TotCaller>({ totId, name: sender.title, via: "linked" });
});

/**
 * A change only a Tot may make. A Tot thread here needs a live run in
 * full-access/default mode, so switching it to plan mode makes it read-only;
 * a linked call carries the same limit in `T3-Mode-Limit`.
 */
export const requireTotChange = Effect.fn("mcp.requireTotChange")(function* () {
  const tot = yield* readTotCaller();
  if (Option.isNone(tot)) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Only a Tot can do this.",
    });
  }
  const context = yield* readCaller();
  yield* assertLiveCaller(context);
  yield* assertFullAccess(context, "A Tot makes changes only in full-access/default mode.");
  return tot.value;
});

/** Refuses what no Tot may do, such as deleting projects or creating threads in its own folder. */
export const refuseTots = Effect.fn("mcp.refuseTots")(function* (message: string) {
  if (Option.isSome(yield* readTotCaller())) {
    return yield* new OrchestratorMcpFailure({ code: "capability_denied", message });
  }
});

/**
 * The sender a forwarded call names. A former Tot thread (turned off or started
 * fresh) still has a `tot:` id; it forwards without one, so a linked environment
 * never grants it a Tot's powers.
 */
export const senderForForwarding = Effect.fnUntraced(function* (
  environmentId: EnvironmentId,
  caller: { readonly id: ThreadId; readonly title: string },
) {
  if (parseTotThreadId(caller.id) !== null) {
    const tots = yield* Effect.serviceOption(TotService.TotService);
    const current = Option.isSome(tots) && Option.isSome(yield* tots.value.totForThread(caller.id));
    if (!current) return undefined;
  }
  return { environmentId, threadId: caller.id, title: caller.title };
});
