import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Fork migration; idempotent like every migration from 99 on (see CUSTOM.md, "Migration ids").
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`
    SELECT name FROM pragma_table_info('scheduled_tasks')
  `;
  const has = new Set(columns.map((column) => column.name));
  if (!has.has("precheck")) yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN precheck TEXT`;
  if (!has.has("missed_run_grace_minutes")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN missed_run_grace_minutes INTEGER`;
  }
  if (!has.has("last_skipped_at")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_skipped_at TEXT`;
  }
  if (!has.has("last_skip_reason")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_skip_reason TEXT`;
  }
  if (!has.has("last_skip_detail")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_skip_detail TEXT`;
  }
});
