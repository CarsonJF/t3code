import type { EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ScopedThreadRef, ThreadId, Tot } from "@t3tools/contracts";

/** A Tot is a thread with a name and a face, so a mention points at its thread. */
export interface ComposerTotItem {
  readonly id: string;
  readonly type: "tot";
  readonly totId: Tot["id"];
  readonly name: string;
  readonly avatar: Tot["avatar"];
  readonly environmentId: EnvironmentId;
  readonly thread: ScopedThreadRef;
  readonly label: string;
  readonly description: string;
}

const COMPOSER_TOT_RESULT_LIMIT = 5;

/** In a Tot's own thread the other Tots and the machines lead; elsewhere threads do. */
export function orderComposerMentionItems<T>(input: {
  readonly isTotChat: boolean;
  readonly tots: ReadonlyArray<T>;
  readonly environments: ReadonlyArray<T>;
  readonly threads: ReadonlyArray<T>;
  readonly rest: ReadonlyArray<T>;
}): T[] {
  return input.isTotChat
    ? [...input.tots, ...input.environments, ...input.threads, ...input.rest]
    : [...input.threads, ...input.tots, ...input.environments, ...input.rest];
}

/**
 * Tots the `@` picker offers beside threads. A Tot without a thread cannot answer, so it is
 * left out, as is the Tot whose own thread is being written in. Like threads and machines,
 * they need a query: bare `@` stays a file picker.
 */
export function matchComposerTotItems(input: {
  tots: ReadonlyArray<EnvironmentTot>;
  environmentId: EnvironmentId;
  excludeThreadId: ThreadId | null;
  /** Machine names, so a Tot hosted elsewhere says where it lives. */
  environmentLabels: ReadonlyMap<EnvironmentId, string>;
  query: string;
}): ComposerTotItem[] {
  const query = input.query.trim().toLowerCase();
  if (query.length === 0) return [];
  return input.tots
    .filter(
      (entry) =>
        entry.tot.threadId !== null &&
        entry.tot.threadId !== input.excludeThreadId &&
        entry.tot.name.toLowerCase().includes(query),
    )
    .slice(0, COMPOSER_TOT_RESULT_LIMIT)
    .map(({ environmentId, tot }) => {
      const machine =
        environmentId === input.environmentId
          ? undefined
          : input.environmentLabels.get(environmentId);
      return {
        id: `tot:${environmentId}:${tot.id}:${tot.threadId}`,
        type: "tot",
        totId: tot.id,
        name: tot.name,
        avatar: tot.avatar,
        environmentId,
        thread: { environmentId, threadId: tot.threadId! },
        label: tot.name,
        description: machine === undefined ? "Tot" : `Tot on ${machine}`,
      };
    });
}
