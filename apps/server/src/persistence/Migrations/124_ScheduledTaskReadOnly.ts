import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Fork migration; idempotent like every migration from 99 on (see CUSTOM.md, "Migration ids").
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`
    SELECT name FROM pragma_table_info('scheduled_tasks')
  `;
  const has = new Set(columns.map((column) => column.name));
  if (!has.has("read_only")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0`;
  }
  if (!has.has("last_sweep_json")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_sweep_json TEXT`;
  }
});
