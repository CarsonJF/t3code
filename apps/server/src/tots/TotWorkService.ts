// A Tot's work list. Objectives and their attempts are rows; every status is derived from the
// runs the watcher sees, so no agent keeps it up to date by hand.
import {
  DEFAULT_TOT_OBJECTIVE_RETRY_CAP,
  type EnvironmentId,
  type RunId,
  type ThreadId,
  type TotId,
  TotError,
  type TotObjective,
  type TotObjectiveAttempt,
  type TotObjectiveAttemptStatus,
  TotObjectiveId,
  type TotWorkList,
  type TotWorkUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import {
  attemptIsOver,
  attemptStatusOf,
  failedAttemptsOf,
  lookIsForAttempt,
  objectiveStatusOf,
} from "./totWork.ts";
import type { WatchedThreadState } from "./totWatchTransitions.ts";

/** The objective a launch is for: an existing one, or a new goal made when the work starts. */
export interface TotObjectiveTarget {
  readonly totId: TotId;
  readonly objectiveId: TotObjectiveId | null;
  readonly title: string;
}

export interface TotNewAttempt {
  readonly kind: TotObjectiveAttempt["kind"];
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly taskId?: string | undefined;
}

const isObjectiveId = Schema.is(TotObjectiveId);

/** A target named by id or by goal, without reading; `attach` finds an open goal of that name. */
export const objectiveTargetOf = (totId: TotId, ref: string): TotObjectiveTarget => {
  const wanted = ref.trim();
  return isObjectiveId(wanted)
    ? { totId, objectiveId: wanted, title: wanted }
    : { totId, objectiveId: null, title: Array.from(wanted).slice(0, 200).join("") };
};

/** The newest objectives a list carries; older ones stay stored. */
const LIST_LIMIT = 50;
const OUTCOME_MAX_CHARS = 500;

export class TotWorkService extends Context.Service<
  TotWorkService,
  {
    /** Resolves `ref` for a launch, refusing an objective past its retry cap. Creates nothing. */
    readonly check: (totId: TotId, ref: string) => Effect.Effect<TotObjectiveTarget, TotError>;
    /** Records work that started for an objective, making the objective if it is new. */
    readonly attach: (
      target: TotObjectiveTarget,
      attempt: TotNewAttempt,
    ) => Effect.Effect<TotObjective, TotError>;
    /** A look at a thread; open attempts there take the status it implies. */
    readonly observe: (
      environmentId: EnvironmentId,
      threadId: ThreadId,
      state: WatchedThreadState,
      outcome: Effect.Effect<string | null>,
    ) => Effect.Effect<void>;
    /** Whether any open attempt is on this thread, so a look elsewhere costs nothing. */
    readonly tracks: (environmentId: EnvironmentId, threadId: ThreadId) => boolean;
    readonly list: (totId: TotId) => Effect.Effect<TotWorkList, TotError>;
    readonly subscribe: (totId: TotId) => Stream.Stream<TotWorkList, TotError>;
    /** Done or cancelled closes an objective; reset clears its failed attempts and reopens it. */
    readonly update: (input: TotWorkUpdateInput) => Effect.Effect<TotObjective, TotError>;
  }
>()("t3/tots/TotWorkService") {}

interface ObjectiveRow {
  readonly id: string;
  readonly tot_id: string;
  readonly title: string;
  readonly closed_as: string | null;
  readonly reset_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AttemptRow {
  readonly id: string;
  readonly objective_id: string;
  readonly kind: string;
  readonly environment_id: string;
  readonly thread_id: string;
  readonly run_id: string | null;
  readonly task_id: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly last_run_id: string | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

const storageError = () => new TotError({ message: "The work list could not be read or saved." });
const keyOf = (environmentId: string, threadId: string) => `${environmentId}\u0000${threadId}`;
const closedAsOf = (value: string | null) =>
  value === "done" || value === "cancelled" ? value : null;

const attemptOf = (row: AttemptRow): TotObjectiveAttempt =>
  ({
    id: row.id,
    kind: row.kind,
    environmentId: row.environment_id,
    threadId: row.thread_id,
    runId: row.run_id,
    taskId: row.task_id,
    status: row.status,
    outcome: row.outcome,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }) as TotObjectiveAttempt;

const objectiveOf = (
  row: ObjectiveRow,
  attempts: ReadonlyArray<AttemptRow>,
  cap: number,
): TotObjective => {
  const facts = {
    closedAs: closedAsOf(row.closed_as),
    resetAt: row.reset_at,
    attempts: attempts.map(attemptOf),
  };
  return {
    id: TotObjectiveId.make(row.id),
    totId: row.tot_id as TotId,
    title: row.title,
    status: objectiveStatusOf(facts, cap),
    failedAttempts: failedAttemptsOf(facts),
    retryCap: cap,
    attempts: facts.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<TotId>();
  const open = new Set(
    (yield* sql<{ readonly environment_id: string; readonly thread_id: string }>`
      SELECT DISTINCT environment_id, thread_id FROM tot_objective_attempts WHERE ended_at IS NULL
    `.pipe(Effect.orElseSucceed(() => []))).map((row) => keyOf(row.environment_id, row.thread_id)),
  );

  const cap = settings.getSettings.pipe(
    Effect.map((current) => current.totObjectiveRetryCap),
    Effect.orElseSucceed(() => DEFAULT_TOT_OBJECTIVE_RETRY_CAP),
  );
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const attemptsFor = Effect.fnUntraced(function* (ids: ReadonlyArray<string>) {
    if (ids.length === 0) return [] as ReadonlyArray<AttemptRow>;
    return yield* sql<AttemptRow>`
      SELECT * FROM tot_objective_attempts WHERE objective_id IN ${sql.in(ids)}
      ORDER BY started_at, id
    `;
  });

  const load = Effect.fnUntraced(function* (totId: TotId, id: string) {
    const [row] = yield* sql<ObjectiveRow>`
      SELECT * FROM tot_objectives WHERE id = ${id} AND tot_id = ${totId}
    `;
    if (row === undefined) return undefined;
    return objectiveOf(row, yield* attemptsFor([row.id]), yield* cap);
  });

  /** The open objective this Tot already has under that goal, so a relaunch does not fork it. */
  const findByTitle = (totId: TotId, title: string) =>
    sql<{ readonly id: string }>`
      SELECT id FROM tot_objectives
      WHERE tot_id = ${totId} AND closed_as IS NULL AND lower(title) = lower(${title})
      ORDER BY updated_at DESC LIMIT 1
    `.pipe(Effect.map(([row]) => row?.id));

  const refuseIfCapped = (objective: TotObjective) =>
    objective.retryCap === 0 || objective.failedAttempts < objective.retryCap
      ? Effect.void
      : Effect.fail(
          new TotError({
            message: `Objective "${objective.title}" (${objective.id}) has had ${objective.failedAttempts} failed or stopped attempts, so it needs a person. Nothing more starts for it until the user resets it in your Work panel, or you mark it done or cancelled with t3_tot_work.`,
          }),
        );

  const check = Effect.fn("TotWorkService.check")(function* (totId: TotId, ref: string) {
    const wanted = ref.trim();
    if (isObjectiveId(wanted)) {
      const objective = yield* load(totId, wanted).pipe(Effect.mapError(storageError));
      if (objective === undefined) {
        return yield* new TotError({
          message: `You have no objective "${wanted}". Pass a short goal to start one.`,
        });
      }
      yield* refuseIfCapped(objective);
      return { totId, objectiveId: objective.id, title: objective.title };
    }
    const { title } = objectiveTargetOf(totId, wanted);
    const existing = yield* findByTitle(totId, title).pipe(Effect.mapError(storageError));
    if (existing !== undefined) {
      const objective = yield* load(totId, existing).pipe(Effect.mapError(storageError));
      if (objective !== undefined) {
        yield* refuseIfCapped(objective);
        return { totId, objectiveId: objective.id, title: objective.title };
      }
    }
    return { totId, objectiveId: null, title };
  });

  const attach = Effect.fn("TotWorkService.attach")(function* (
    target: TotObjectiveTarget,
    attempt: TotNewAttempt,
  ) {
    const objective = yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const now = yield* nowIso;
          // A parallel launch may have made the same goal since the check.
          const objectiveId =
            target.objectiveId ??
            (yield* findByTitle(target.totId, target.title)) ??
            `obj-${(yield* random.uuidV4()).replaceAll("-", "").slice(0, 12)}`;
          yield* sql`
          INSERT INTO tot_objectives (id, tot_id, title, created_at, updated_at)
          VALUES (${objectiveId}, ${target.totId}, ${target.title}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET closed_as = NULL, updated_at = ${now}
        `;
          yield* sql`
          INSERT INTO tot_objective_attempts
            (id, objective_id, kind, environment_id, thread_id, run_id, task_id, status, started_at)
          VALUES (
            ${`att-${yield* random.uuidV4()}`}, ${objectiveId}, ${attempt.kind},
            ${attempt.environmentId}, ${attempt.threadId}, ${attempt.runId},
            ${attempt.taskId ?? null}, ${"working"}, ${now}
          )
        `;
          open.add(keyOf(attempt.environmentId, attempt.threadId));
          return yield* load(target.totId, objectiveId);
        }),
      )
      .pipe(Effect.mapError(storageError));
    if (objective === undefined) return yield* storageError();
    yield* PubSub.publish(changes, target.totId);
    return objective;
  });

  const observe = Effect.fn("TotWorkService.observe")(function* (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    state: WatchedThreadState,
    outcome: Effect.Effect<string | null>,
  ) {
    const key = keyOf(environmentId, threadId);
    if (!open.has(key)) return;
    const status = attemptStatusOf(state);
    if (status === null) return;
    const changed = yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const rows = yield* sql<AttemptRow & { readonly tot_id: string }>`
          SELECT a.*, o.tot_id FROM tot_objective_attempts a
          JOIN tot_objectives o ON o.id = a.objective_id
          WHERE a.environment_id = ${environmentId} AND a.thread_id = ${threadId}
            AND a.ended_at IS NULL
        `;
          const now = yield* nowIso;
          const touched = new Set<string>();
          let text: string | null | undefined;
          for (const row of rows) {
            const attempt = { runId: row.run_id, lastRunId: row.last_run_id };
            if (!lookIsForAttempt(attempt, state)) continue;
            const lastRunId = state.runId ?? row.last_run_id;
            if (row.status === status && row.last_run_id === lastRunId) continue;
            const over = attemptIsOver(status as TotObjectiveAttemptStatus);
            if (over && text === undefined) {
              const said = yield* outcome;
              text = said === null ? null : Array.from(said).slice(-OUTCOME_MAX_CHARS).join("");
            }
            yield* sql`
            UPDATE tot_objective_attempts
            SET status = ${status}, last_run_id = ${lastRunId},
              ended_at = ${over ? now : null}, outcome = ${over ? (text ?? null) : row.outcome}
            WHERE id = ${row.id}
          `;
            yield* sql`UPDATE tot_objectives SET updated_at = ${now} WHERE id = ${row.objective_id}`;
            touched.add(row.tot_id);
          }
          const [stillOpen] = yield* sql<{ readonly one: number }>`
          SELECT 1 AS one FROM tot_objective_attempts
          WHERE environment_id = ${environmentId} AND thread_id = ${threadId} AND ended_at IS NULL
          LIMIT 1
        `;
          if (stillOpen === undefined) open.delete(key);
          return touched;
        }),
      )
      .pipe(
        Effect.tapError((cause) => Effect.logWarning("Tot work list update failed", cause)),
        Effect.orElseSucceed(() => new Set<string>()),
      );
    for (const totId of changed) yield* PubSub.publish(changes, totId as TotId);
  });

  const list = Effect.fn("TotWorkService.list")(function* (totId: TotId) {
    const rows = yield* sql<ObjectiveRow>`
      SELECT * FROM tot_objectives WHERE tot_id = ${totId}
      ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
    `.pipe(Effect.mapError(storageError));
    const attempts = yield* attemptsFor(rows.map((row) => row.id)).pipe(
      Effect.mapError(storageError),
    );
    const retryCap = yield* cap;
    return {
      objectives: rows.map((row) =>
        objectiveOf(
          row,
          attempts.filter((attempt) => attempt.objective_id === row.id),
          retryCap,
        ),
      ),
    } satisfies TotWorkList;
  });

  const subscribe = (totId: TotId): Stream.Stream<TotWorkList, TotError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribed before the first read, so a change during it is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list(totId)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === totId),
            Stream.mapEffect(() => list(totId)),
          ),
        );
      }),
    );

  const update = Effect.fn("TotWorkService.update")(function* (input: TotWorkUpdateInput) {
    const objective = yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const now = yield* nowIso;
          const result =
            input.action === "reset"
              ? yield* sql`
                UPDATE tot_objectives SET closed_as = NULL, reset_at = ${now}, updated_at = ${now}
                WHERE id = ${input.objectiveId} AND tot_id = ${input.id} RETURNING id
              `
              : yield* sql`
                UPDATE tot_objectives SET closed_as = ${input.action}, updated_at = ${now}
                WHERE id = ${input.objectiveId} AND tot_id = ${input.id} RETURNING id
              `;
          return result.length === 0 ? undefined : yield* load(input.id, input.objectiveId);
        }),
      )
      .pipe(Effect.mapError(storageError));
    if (objective === undefined) {
      return yield* new TotError({ message: `There is no objective "${input.objectiveId}".` });
    }
    yield* PubSub.publish(changes, input.id);
    return objective;
  });

  return TotWorkService.of({
    check,
    attach,
    observe,
    tracks: (environmentId, threadId) => open.has(keyOf(environmentId, threadId)),
    list,
    subscribe,
    update,
  });
});

export const layer = Layer.effect(TotWorkService, make);
