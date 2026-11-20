import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Tasks made through a Tot's MCP tools carry their author, so a settings panel
  // can find them in any project. Rows from before this column have no author.
  // Idempotent: a history that recorded it at another id replays it (see Migrations.ts).
  const existing = yield* sql`
    SELECT 1 FROM pragma_table_info('scheduled_tasks') WHERE name = 'created_by_tot_id'
  `;
  if (existing.length > 0) return;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN created_by_tot_id TEXT`;
});
