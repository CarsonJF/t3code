import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Fork: idempotent, so a history recorded in another order replays it (see Migrations.ts).
  yield* sql`CREATE TABLE IF NOT EXISTS tot_objectives (
    id TEXT PRIMARY KEY, tot_id TEXT NOT NULL, title TEXT NOT NULL,
    closed_as TEXT, reset_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS tot_objectives_tot ON tot_objectives (tot_id, updated_at)`;
  yield* sql`CREATE TABLE IF NOT EXISTS tot_objective_attempts (
    id TEXT PRIMARY KEY, objective_id TEXT NOT NULL, kind TEXT NOT NULL,
    environment_id TEXT NOT NULL, thread_id TEXT NOT NULL, run_id TEXT, task_id TEXT,
    status TEXT NOT NULL, outcome TEXT, last_run_id TEXT,
    started_at TEXT NOT NULL, ended_at TEXT
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS tot_objective_attempts_objective
    ON tot_objective_attempts (objective_id, started_at)`;
  // The watcher asks on every thread change whether an open attempt is there.
  yield* sql`CREATE INDEX IF NOT EXISTS tot_objective_attempts_open
    ON tot_objective_attempts (environment_id, thread_id) WHERE ended_at IS NULL`;
});
