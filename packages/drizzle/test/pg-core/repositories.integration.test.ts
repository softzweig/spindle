import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  type Asset,
  describeRepositoryContract,
} from "../../../core/test/contract/repository.contract.js";
import { PostgresRepository } from "../../src/pg-core/repositories.js";
import { type CreatedAtCursor, pagingByCreatedAt } from "../../src/repository.js";
import { type AssetFilter, type AssetSizeFilter, assets, assetsDdl } from "../support/assets.js";

/** The shared repository contract, against PGlite. */
describeRepositoryContract("pg-core", async () => {
  const client = new PGlite();
  const db = drizzle(client);

  await client.exec(assetsDdl);

  return {
    assets: PostgresRepository.of(db, assets),
    assetsBySize: PostgresRepository.of<typeof assets, AssetSizeFilter>(db, assets),
    assetsNewest: new PostgresRepository<typeof assets, Asset, AssetFilter, CreatedAtCursor<Asset>>(
      db,
      assets,
      pagingByCreatedAt(assets),
    ),
    reset: async () => {
      await client.exec('delete from "assets"');
    },
    close: () => client.close(),
  };
});
