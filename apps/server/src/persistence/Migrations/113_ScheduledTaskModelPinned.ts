import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A task can pin its model, so bound runs stop following the thread's current one.
  // Idempotent: a history that recorded it at another id replays it (see Migrations.ts).
  const existing = yield* sql`
    SELECT 1 FROM pragma_table_info('scheduled_tasks') WHERE name = 'model_pinned'
  `;
  if (existing.length > 0) return;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN model_pinned INTEGER NOT NULL DEFAULT 0`;
});
