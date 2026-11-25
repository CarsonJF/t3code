import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // What a workflow tags its run with, as a JSON list, for filtering runs.
  // Fork: idempotent, so a history recorded in another order replays it (see Migrations.ts).
  const existing = yield* sql`
    SELECT 1 FROM pragma_table_info('workflow_runs') WHERE name = 'tags_json'
  `;
  if (existing.length > 0) return;
  yield* sql`ALTER TABLE workflow_runs ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'`;
});
