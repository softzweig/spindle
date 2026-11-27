import {
  type Asset,
  type AssetFilter,
  type AssetSizeFilter,
  describeRepositoryContract,
} from "../../core/test/contract/repository.contract.js";
import { MemoryRepository } from "../src/repository.js";
import { MemoryStore } from "../src/store.js";

/**
 * The same contract the SQL adapters run, over one store: whatever a caller can expect
 * from `@softzweig/spindle-drizzle` has to hold here too, which is what keeps the two
 * interchangeable.
 */
describeRepositoryContract("memory", async () => {
  const store = new MemoryStore<Asset>();

  return {
    assets: MemoryRepository.byId<Asset, AssetFilter>(store),
    assetsBySize: MemoryRepository.byId<Asset, AssetSizeFilter>(store),
    assetsNewest: MemoryRepository.byCreatedAt<Asset, AssetFilter>(store),
    reset: async () => {
      store.clear();
    },
    close: async () => {},
  };
});
