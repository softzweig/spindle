import { PGlite } from "@electric-sql/pglite";
import type { Repository } from "@softzweig/spindle-core/repository";
import { drizzle } from "drizzle-orm/pglite";
import { createPostgresAdapters } from "../../src/pg-core/adapters.js";
import { PostgresRepository } from "../../src/pg-core/repositories.js";
import type { DrizzleContext } from "../../src/repository.js";
import { describeAdapters } from "../contract/adapters.integration.js";
import { type Asset, type AssetFilter, assets, assetsDdl } from "../support/assets.js";

type AssetRepository = Repository<Asset, DrizzleContext, AssetFilter>;

describeAdapters("pg-core", async () => {
  const client = new PGlite();
  const db = drizzle(client);

  await client.exec(assetsDdl);

  const assetsRepository: AssetRepository = PostgresRepository.of(db, assets);
  const mirrorRepository: AssetRepository = PostgresRepository.of(db, assets);
  const repositories: { readonly assets: AssetRepository; readonly mirror: AssetRepository } = {
    assets: assetsRepository,
    mirror: mirrorRepository,
  };

  return {
    adapters: createPostgresAdapters(db, repositories),
    assets: assetsRepository,
    mirror: mirrorRepository,
    reset: async () => {
      await client.exec('delete from "assets"');
    },
    close: () => client.close(),
  };
});
