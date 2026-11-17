import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Tasks made through a Tot's MCP tools carry their author, so a settings panel
  // can find them in any project. Rows from before this column have no author.
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN created_by_tot_id TEXT`;
});
