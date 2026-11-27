import { beforeEach, describe, expect, it } from "vitest";
import {
  type Asset,
  type AssetFilter,
  newAsset,
} from "../../core/test/contract/repository.contract.js";
import { type CreatedAtCursor, MemoryRepository } from "../src/repository.js";
import { MemoryStore } from "../src/store.js";

/**
 * What only the in-memory repository does: rows kept per store, snapshots per transaction,
 * and cursors of the caller's own making. Everything it shares with the SQL adapters is
 * covered by `repository.contract.test.ts`.
 */
describe("MemoryRepository", () => {
  let assets: MemoryRepository<Asset, AssetFilter>;

  beforeEach(() => {
    assets = MemoryRepository.byId<Asset, AssetFilter>();
  });

  const givenAsset = async (overrides: Partial<Asset> = {}) => {
    const asset = newAsset(overrides);
    await assets.insert(asset);

    return asset;
  };

  describe("reads", () => {
    it("returns the rows of an empty filter in insertion order", async () => {
      const rows = [await givenAsset(), await givenAsset()];

      await expect(assets.findMany({})).resolves.toEqual(rows);
    });
  });

  describe("writes", () => {
    it("generates an id when the caller does not supply one", async () => {
      const inserted = await assets.insert({
        key: "a.png",
        size: 42,
        note: null,
        createdAt: new Date(),
      });

      expect(inserted.id).toEqual(expect.any(String));
      await expect(assets.findById(inserted.id)).resolves.toEqual(inserted);
    });

    it("keeps its own copy of an inserted entity", async () => {
      const asset = newAsset();
      await assets.insert(asset);

      const mutated = { ...asset, key: "changed.png" };

      await expect(assets.findById(asset.id)).resolves.toEqual(asset);
      expect(mutated.key).toBe("changed.png");
    });
  });

  describe("transactions", () => {
    it("rolls patches and deletes back too", async () => {
      const asset = await givenAsset({ size: 10 });
      const removed = await givenAsset();

      await expect(
        assets.transaction(async (context) => {
          await assets.withContext(context).patch(asset.id, { size: 64 });
          await assets.withContext(context).delete([removed.id]);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      await expect(assets.findById(asset.id)).resolves.toEqual(asset);
      await expect(assets.findById(removed.id)).resolves.toEqual(removed);
    });

    it("shares rows and rollbacks between repositories on the same store", async () => {
      const store = new MemoryStore<Asset>();
      const writer = MemoryRepository.byId<Asset, AssetFilter>(store);
      const reader = MemoryRepository.byId<Asset, AssetFilter>(store);
      const asset = newAsset();

      await expect(
        writer.transaction(async (context) => {
          await writer.withContext(context).insert(asset);

          await expect(reader.findById(asset.id)).resolves.toEqual(asset);

          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      await expect(reader.findById(asset.id)).resolves.toBeNull();
    });

    it("keeps repositories on separate stores independent", async () => {
      const other = MemoryRepository.byId<Asset, AssetFilter>();
      const asset = await givenAsset();

      await expect(other.findMany({})).resolves.toEqual([]);
      await expect(other.findById(asset.id)).resolves.toBeNull();
    });
  });

  describe("list", () => {
    it("pages by a cursor of the caller's making", async () => {
      // Largest first, with the size itself as the cursor: the sizes are distinct, so it
      // orders the rows on its own.
      const sized = new MemoryRepository<Asset, AssetFilter, number>(
        {
          read: (asset) => asset.size,
          compare: (left, right) => right - left,
        },
        new MemoryStore(),
      );
      const small = await sized.insert(newAsset({ key: "small.png", size: 10 }));
      const large = await sized.insert(newAsset({ key: "large.png", size: 30 }));
      const medium = await sized.insert(newAsset({ key: "medium.png", size: 20 }));

      const first = await sized.list({ limit: 1 });
      const second = await sized.list({ limit: 1, cursor: first.nextCursor ?? undefined });
      const third = await sized.list({ limit: 1, cursor: second.nextCursor ?? undefined });

      expect(first.items).toEqual([large]);
      expect(first.nextCursor).toBe(30);
      expect(second.items).toEqual([medium]);
      expect(second.nextCursor).toBe(20);
      expect(third.items).toEqual([small]);
      expect(third.nextCursor).toBeNull();
    });

    it("refuses to order composite cursors it cannot compare", async () => {
      const unordered = new MemoryRepository<Asset, AssetFilter, CreatedAtCursor<Asset>>({
        read: (asset) => ({ createdAt: asset.createdAt, id: asset.id }),
      });
      await unordered.insert(newAsset());
      await unordered.insert(newAsset());

      await expect(unordered.list({ limit: 2 })).rejects.toThrow(
        "composite cursors need a comparator",
      );
    });
  });
});
