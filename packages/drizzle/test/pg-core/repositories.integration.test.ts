import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PostgresRepository } from "../../src/pg-core/repositories.js";
import { describeRepositories } from "../contract/repositories.integration.js";
import { type AssetSizeFilter, assets, assetsDdl } from "../support/assets.js";

/** The shared repository contract, against PGlite. */
describeRepositories("pg-core", async () => {
  const client = new PGlite();
  const db = drizzle(client);

  await client.exec(assetsDdl);

  return {
    assets: PostgresRepository.of(db, assets),
    assetsBySize: PostgresRepository.of<typeof assets, AssetSizeFilter>(db, assets),
    reset: async () => {
      await client.exec('delete from "assets"');
    },
    close: () => client.close(),
  };
});
