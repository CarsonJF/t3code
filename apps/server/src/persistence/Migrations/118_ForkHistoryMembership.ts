import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Pruned lifecycle events cannot establish complete membership; historical forks keep the timestamp fallback.
  // Fork: idempotent, so a history recorded in another order replays it (see Migrations.ts).
  const existing = yield* sql`
    SELECT 1 FROM pragma_table_info('orchestration_v2_projection_threads') WHERE name = 'fork_run_ids_json'
  `;
  if (existing.length > 0) return;
  yield* sql`ALTER TABLE orchestration_v2_projection_threads ADD COLUMN fork_run_ids_json TEXT`;
});
