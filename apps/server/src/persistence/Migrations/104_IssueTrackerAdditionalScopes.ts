import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Fork: idempotent, so a history recorded in another order replays it (see Migrations.ts).
  const existing = yield* sql`
    SELECT 1 FROM pragma_table_info('issue_tracker_bindings') WHERE name = 'additional_scopes'
  `;
  if (existing.length > 0) return;
  yield* sql`
    ALTER TABLE issue_tracker_bindings ADD COLUMN additional_scopes TEXT NOT NULL DEFAULT '[]'
  `;
});
