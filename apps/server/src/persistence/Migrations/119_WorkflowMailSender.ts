import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Fork: idempotent, so a history recorded in another order replays it (see Migrations.ts).
  const existing = yield* sql`
    SELECT 1 FROM pragma_table_info('workflow_mail') WHERE name = 'sender_json'
  `;
  if (existing.length > 0) return;
  // Who sent a kept signal and when, as the server saw it on receiving it. Null on one kept before.
  yield* sql`ALTER TABLE workflow_mail ADD COLUMN sender_json TEXT`;
});
