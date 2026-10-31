import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
// A revision-protected aggregate serializes invoice claims and PO reservations.
// Original files live separately in R2.
export const workspaces = sqliteTable("workspaces", {
  owner: text("owner").primaryKey(),
  revision: integer("revision").notNull().default(0),
  state: text("state").notNull(),
});
