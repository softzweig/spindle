import { createClient } from "@libsql/client";
import type { Repository } from "@softzweig/spindle-core/repository";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Asset } from "../../../core/test/contract/repository.contract.js";
import type { DrizzleContext } from "../../src/repository.js";
import { createSqliteAdapters } from "../../src/sqlite-core/adapters.js";
import { SqliteRepository } from "../../src/sqlite-core/repositories.js";
import { describeAdapters } from "../contract/adapters.integration.js";
import { type AssetFilter, assetsDdl } from "../support/assets.js";

const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

type AssetRepository = Repository<Asset, DrizzleContext, AssetFilter>;

describeAdapters("sqlite-core", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);

  await client.execute(assetsDdl);

  const assetsRepository: AssetRepository = SqliteRepository.of(db, assets);
  const mirrorRepository: AssetRepository = SqliteRepository.of(db, assets);
  const repositories: { readonly assets: AssetRepository; readonly mirror: AssetRepository } = {
    assets: assetsRepository,
    mirror: mirrorRepository,
  };

  return {
    adapters: createSqliteAdapters(db, repositories),
    assets: assetsRepository,
    mirror: mirrorRepository,
    reset: async () => {
      await client.execute('delete from "assets"');
    },
    close: async () => {
      client.close();
    },
  };
});
