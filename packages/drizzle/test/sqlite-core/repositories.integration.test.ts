import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SqliteRepository } from "../../src/sqlite-core/repositories.js";
import { describeRepositories } from "../contract/repositories.integration.js";
import { type AssetSizeFilter, assetsDdl } from "../support/assets.js";

const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
  note: text("note"),
});

/** The shared repository contract, against libSQL. */
describeRepositories("sqlite-core", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);

  await client.execute(assetsDdl);

  return {
    assets: SqliteRepository.of(db, assets),
    assetsBySize: SqliteRepository.of<typeof assets, AssetSizeFilter>(db, assets),
    reset: async () => {
      await client.execute('delete from "assets"');
    },
    close: async () => {
      client.close();
    },
  };
});
