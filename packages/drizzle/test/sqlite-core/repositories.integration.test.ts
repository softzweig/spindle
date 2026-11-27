import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  type Asset,
  describeRepositoryContract,
} from "../../../core/test/contract/repository.contract.js";
import { type CreatedAtCursor, pagingByCreatedAt } from "../../src/repository.js";
import { SqliteRepository } from "../../src/sqlite-core/repositories.js";
import { type AssetFilter, type AssetSizeFilter, assetsDdl } from "../support/assets.js";

const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** The shared repository contract, against libSQL. */
describeRepositoryContract("sqlite-core", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);

  await client.execute(assetsDdl);

  return {
    assets: SqliteRepository.of(db, assets),
    assetsBySize: SqliteRepository.of<typeof assets, AssetSizeFilter>(db, assets),
    assetsNewest: new SqliteRepository<typeof assets, Asset, AssetFilter, CreatedAtCursor<Asset>>(
      db,
      assets,
      pagingByCreatedAt(assets),
    ),
    reset: async () => {
      await client.execute('delete from "assets"');
    },
    close: async () => {
      client.close();
    },
  };
});
