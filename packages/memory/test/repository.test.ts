import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repository.js";
import { MemoryStore } from "../src/store.js";
import { type Asset, type AssetFilter, type AssetSizeFilter, newAsset } from "./support/assets.js";

describe("MemoryRepository", () => {
  let assets: MemoryRepository<Asset, AssetFilter>;

  beforeEach(() => {
    assets = new MemoryRepository<Asset, AssetFilter>();
  });

  const givenAsset = async (overrides: Partial<Asset> = {}) => {
    const asset = newAsset(overrides);
    await assets.insert(asset);

    return asset;
  };

  const ids = (rows: readonly { id: string }[]) => rows.map(({ id }) => id).sort();

  describe("reads", () => {
    it("finds a row by id", async () => {
      const asset = await givenAsset();

      await expect(assets.findById(asset.id)).resolves.toEqual(asset);
    });

    it("returns null for an unknown id", async () => {
      await expect(assets.findById("missing")).resolves.toBeNull();
    });

    it("finds one row or null", async () => {
      const asset = await givenAsset();

      await expect(assets.findOne({ key: asset.key })).resolves.toEqual(asset);
      await expect(assets.findOne({ key: "missing" })).resolves.toBeNull();
    });

    it("finds rows by ids, ignoring unknown ones", async () => {
      const a = await givenAsset();
      const b = await givenAsset();

      const found = await assets.findByIds([a.id, "missing", b.id]);

      expect(ids(found)).toEqual(ids([a, b]));
    });

    it("returns no rows for an empty id list", async () => {
      await expect(assets.findByIds([])).resolves.toEqual([]);
    });

    it("returns all rows for an empty filter, in insertion order", async () => {
      const rows = [await givenAsset(), await givenAsset()];

      await expect(assets.findMany({})).resolves.toEqual(rows);
    });

    it("filters by a scalar property", async () => {
      const a = await givenAsset({ key: "a.png" });
      await givenAsset({ key: "b.png" });

      await expect(assets.findMany({ key: "a.png" })).resolves.toEqual([a]);
    });

    it("filters by an array of values", async () => {
      const a = await givenAsset({ key: "a.png" });
      const b = await givenAsset({ key: "b.png" });
      await givenAsset({ key: "c.png" });

      const found = await assets.findMany({ key: ["a.png", "b.png"] });

      expect(ids(found)).toEqual(ids([a, b]));
    });

    it("matches nothing for an empty array filter", async () => {
      await givenAsset();

      await expect(assets.findMany({ key: [] })).resolves.toEqual([]);
    });

    it("filters on a null value", async () => {
      const tagged = await givenAsset({ note: "reviewed" });
      const untagged = await givenAsset();

      await expect(assets.findMany({ note: null })).resolves.toEqual([untagged]);
      await expect(assets.findMany({ note: "reviewed" })).resolves.toEqual([tagged]);
    });

    it("combines properties with AND", async () => {
      const matching = await givenAsset({ key: "a.png", size: 10 });
      await givenAsset({ key: "a.png", size: 20 });
      await givenAsset({ key: "b.png", size: 10 });

      await expect(assets.findMany({ key: "a.png", size: 10 })).resolves.toEqual([matching]);
    });

    it("ignores undefined filter values", async () => {
      const asset = await givenAsset();

      await expect(assets.findMany({ id: asset.id, size: undefined })).resolves.toEqual([asset]);
    });

    it("honors a limit", async () => {
      const rows = [await givenAsset(), await givenAsset(), await givenAsset()];

      await expect(assets.findMany({ limit: 2 })).resolves.toEqual(rows.slice(0, 2));
      await expect(assets.findMany({ limit: 0 })).resolves.toEqual([]);
    });

    it("counts all rows and matching rows", async () => {
      await givenAsset({ size: 10 });
      await givenAsset({ size: 20 });

      await expect(assets.count({})).resolves.toBe(2);
      await expect(assets.count({ size: 10 })).resolves.toBe(1);
      await expect(assets.count({ size: 99 })).resolves.toBe(0);
    });

    it("reports whether a row exists", async () => {
      const asset = await givenAsset();

      await expect(assets.exists({ key: asset.key })).resolves.toBe(true);
      await expect(assets.exists({ key: "missing" })).resolves.toBe(false);
    });
  });

  describe("writes", () => {
    it("generates an id when the caller does not supply one", async () => {
      const inserted = await assets.insert({ key: "a.png", size: 42, note: null });

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

    it("patches one row by id", async () => {
      const asset = await givenAsset();
      const patched = { ...asset, size: 64 };

      await expect(assets.patch(asset.id, { size: 64 })).resolves.toEqual(patched);
      await expect(assets.findById(asset.id)).resolves.toEqual(patched);
    });

    it("rejects patching an unknown id", async () => {
      await expect(assets.patch("missing", { size: 64 })).rejects.toThrow();
    });

    it("patches every matching row", async () => {
      const rows = [await givenAsset({ key: "shared" }), await givenAsset({ key: "shared" })];
      const kept = await givenAsset({ key: "kept" });

      const patched = await assets.patchWhere({ key: "shared" }, { size: 64 });

      expect(ids(patched)).toEqual(ids(rows));
      expect(patched.every(({ size }) => size === 64)).toBe(true);
      await expect(assets.findById(kept.id)).resolves.toEqual(kept);
    });

    it("does not patch when the filter has no clause", async () => {
      await givenAsset();

      await expect(assets.patchWhere({}, { size: 64 })).resolves.toEqual([]);
      await expect(assets.patchWhere({ size: undefined }, { size: 64 })).resolves.toEqual([]);
    });

    it("deletes rows by id", async () => {
      const asset = await givenAsset();
      const kept = await givenAsset();

      await expect(assets.delete([asset.id])).resolves.toEqual([asset]);
      await expect(assets.findById(asset.id)).resolves.toBeNull();
      await expect(assets.findById(kept.id)).resolves.toEqual(kept);
    });

    it("deletes every matching row", async () => {
      const gone = await givenAsset({ key: "gone" });
      await givenAsset({ key: "kept" });

      await expect(assets.deleteWhere({ key: "gone" })).resolves.toEqual([gone]);
      await expect(assets.findById(gone.id)).resolves.toBeNull();
    });

    it("does not delete when the filter has no clause", async () => {
      await givenAsset();

      await expect(assets.deleteWhere({})).resolves.toEqual([]);
    });
  });

  describe("transactions", () => {
    it("reports the transactional context", async () => {
      const isInTransaction = await assets.transaction(async (context) => context.isInTransaction);

      expect(isInTransaction).toBe(true);
    });

    it("binds the transactional copy as `this`", async () => {
      const asset = newAsset();

      await assets.transaction(async function () {
        expect(this).not.toBe(assets);
        expect(this.getContext().isInTransaction).toBe(true);

        await this.insert(asset);
      });

      await expect(assets.findById(asset.id)).resolves.toEqual(asset);
    });

    it("commits writes made inside the transaction", async () => {
      const asset = newAsset();

      await assets.transaction(async (context) => {
        await assets.withContext(context).insert(asset);
      });

      await expect(assets.findById(asset.id)).resolves.toEqual(asset);
    });

    it("rolls writes back with the transaction", async () => {
      const kept = await givenAsset();
      const discarded = newAsset();

      await expect(
        assets.transaction(async (context) => {
          await assets.withContext(context).insert(discarded);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      await expect(assets.findById(discarded.id)).resolves.toBeNull();
      await expect(assets.findById(kept.id)).resolves.toEqual(kept);
    });

    it("rolls back only the nested scope that failed", async () => {
      const outer = newAsset();
      const inner = newAsset();

      await assets.transaction(async (context) => {
        await assets.withContext(context).insert(outer);

        await expect(
          assets.withContext(context).transaction(async (nested) => {
            await assets.withContext(nested).insert(inner);
            throw new Error("nested rollback");
          }),
        ).rejects.toThrow("nested rollback");
      });

      await expect(assets.findById(outer.id)).resolves.toEqual(outer);
      await expect(assets.findById(inner.id)).resolves.toBeNull();
    });

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
      const writer = new MemoryRepository<Asset, AssetFilter>(store);
      const reader = new MemoryRepository<Asset, AssetFilter>(store);
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
      const other = new MemoryRepository<Asset, AssetFilter>();
      const asset = await givenAsset();

      await expect(other.findMany({})).resolves.toEqual([]);
      await expect(other.findById(asset.id)).resolves.toBeNull();
    });
  });

  describe("filters", () => {
    it("accepts a narrowed filter", async () => {
      const sized = new MemoryRepository<Asset, AssetSizeFilter>();
      const asset = newAsset({ size: 42 });
      await sized.insert(asset);

      await expect(sized.findMany({ size: 42 })).resolves.toEqual([asset]);

      // @ts-expect-error the filter narrows to a required size
      void sized.findMany({});
    });
  });
});
