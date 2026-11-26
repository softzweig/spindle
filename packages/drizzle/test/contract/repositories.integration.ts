import type { Repository } from "@softzweig/spindle-core/repository";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleContext } from "../../src/repository.js";
import { type Asset, type AssetFilter, type AssetSizeFilter, newAsset } from "../support/assets.js";

export type TestDatabase = {
  readonly assets: Repository<Asset, DrizzleContext, AssetFilter>;
  /** The same table, read through a filter that requires `size`. */
  readonly assetsBySize: Repository<Asset, DrizzleContext, AssetSizeFilter>;
  reset(): Promise<void>;
  close(): Promise<void>;
};

/** Behavior every dialect must share, run against a real database. */
export function describeRepositories(name: string, create: () => Promise<TestDatabase>) {
  describe(name, () => {
    let db: TestDatabase;

    beforeAll(async () => {
      db = await create();
    });

    afterAll(async () => {
      await db.close();
    });

    beforeEach(async () => {
      await db.reset();
    });

    const givenAsset = async (overrides: Partial<Asset> = {}) => {
      const asset = newAsset(overrides);
      await db.assets.insert(asset);

      return asset;
    };

    const ids = (rows: readonly { id: string }[]) => rows.map(({ id }) => id).sort();

    describe("reads", () => {
      it("finds a row by id", async () => {
        const asset = await givenAsset();

        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("returns null for an unknown id", async () => {
        await expect(db.assets.findById("missing")).resolves.toBeNull();
      });

      it("finds one row or null", async () => {
        const asset = await givenAsset();

        await expect(db.assets.findOne({ key: asset.key })).resolves.toEqual(asset);
        await expect(db.assets.findOne({ key: "missing" })).resolves.toBeNull();
      });

      it("finds rows by ids, ignoring unknown ones", async () => {
        const a = await givenAsset();
        const b = await givenAsset();

        const found = await db.assets.findByIds([a.id, "missing", b.id]);

        expect(ids(found)).toEqual(ids([a, b]));
      });

      it("returns no rows for an empty id list", async () => {
        await expect(db.assets.findByIds([])).resolves.toEqual([]);
      });

      it("matches nothing for an empty array filter", async () => {
        await givenAsset();

        await expect(db.assets.findMany({ key: [] })).resolves.toEqual([]);
      });

      it("filters by a scalar property", async () => {
        const a = await givenAsset({ key: "a.png" });
        await givenAsset({ key: "b.png" });

        await expect(db.assets.findMany({ key: "a.png" })).resolves.toEqual([a]);
      });

      it("filters by an array of values", async () => {
        const a = await givenAsset({ key: "a.png" });
        const b = await givenAsset({ key: "b.png" });
        await givenAsset({ key: "c.png" });

        const found = await db.assets.findMany({ key: ["a.png", "b.png"] });

        expect(ids(found)).toEqual(ids([a, b]));
      });

      it("filters on a null value", async () => {
        const tagged = await givenAsset({ note: "reviewed" });
        const untagged = await givenAsset();

        await expect(db.assets.findMany({ note: null })).resolves.toEqual([untagged]);
        await expect(db.assets.findMany({ note: "reviewed" })).resolves.toEqual([tagged]);
      });

      it("combines properties with AND", async () => {
        const matching = await givenAsset({ key: "a.png", size: 10 });
        await givenAsset({ key: "a.png", size: 20 });
        await givenAsset({ key: "b.png", size: 10 });

        await expect(db.assets.findMany({ key: "a.png", size: 10 })).resolves.toEqual([matching]);
      });

      it("returns all rows for an empty filter", async () => {
        const rows = [await givenAsset(), await givenAsset()];

        expect(ids(await db.assets.findMany({}))).toEqual(ids(rows));
      });

      it("ignores undefined filter values", async () => {
        const asset = await givenAsset();

        await expect(db.assets.findMany({ id: asset.id, size: undefined })).resolves.toEqual([
          asset,
        ]);
      });

      it("honors a limit", async () => {
        await givenAsset();
        await givenAsset();
        await givenAsset();

        await expect(db.assets.findMany({ limit: 2 })).resolves.toHaveLength(2);
      });

      it("counts matching rows", async () => {
        await givenAsset({ size: 100 });
        await givenAsset({ size: 250 });

        await expect(db.assets.count({})).resolves.toBe(2);
        await expect(db.assets.count({ size: 100 })).resolves.toBe(1);
        await expect(db.assets.count({ size: 999 })).resolves.toBe(0);
      });

      it("accepts sql filter values", async () => {
        const asset = await givenAsset({ key: "a.png" });
        await givenAsset({ key: "b.png" });

        await expect(db.assets.findMany({ key: sql`'a.png'` })).resolves.toEqual([asset]);
      });

      it("rejects a filter property without a column", async () => {
        await expect(db.assets.findMany({ nope: "x" } as unknown as AssetFilter)).rejects.toThrow(
          TypeError,
        );
      });
    });

    describe("filters", () => {
      it("applies a narrowed filter", async () => {
        const asset = await givenAsset({ size: 42 });
        await givenAsset({ size: 7 });

        await expect(db.assetsBySize.findMany({ size: 42 })).resolves.toEqual([asset]);
      });

      it("requires the narrowed property", () => {
        // @ts-expect-error the filter narrows to a required size
        void db.assetsBySize.findMany({});
      });
    });

    describe("writes", () => {
      it("inserts and reads the row", async () => {
        const asset = newAsset();

        await expect(db.assets.insert(asset)).resolves.toEqual(asset);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("patches one row by id", async () => {
        const asset = await givenAsset();
        const patched = { ...asset, size: 64 };

        await expect(db.assets.patch(asset.id, { size: 64 })).resolves.toEqual(patched);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(patched);
      });

      it("rejects patching an unknown id", async () => {
        await expect(db.assets.patch("missing", { size: 64 })).rejects.toThrow();
      });

      it("patches every matching row", async () => {
        const rows = [await givenAsset({ key: "shared" }), await givenAsset({ key: "shared" })];

        const patched = await db.assets.patchWhere({ key: "shared" }, { size: 64 });

        expect(ids(patched)).toEqual(ids(rows));
        expect(patched.every(({ size }) => size === 64)).toBe(true);
      });

      it("does not patch when the filter is empty", async () => {
        const asset = await givenAsset();

        await expect(db.assets.patchWhere({}, { size: 64 })).resolves.toEqual([]);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("returns no rows when a patch matches nothing", async () => {
        await givenAsset();

        await expect(db.assets.patchWhere({ key: "missing" }, { size: 64 })).resolves.toEqual([]);
      });

      it("rejects an unknown patch filter property", async () => {
        await expect(
          db.assets.patchWhere({ nope: "x" } as unknown as AssetFilter, { size: 64 }),
        ).rejects.toThrow(TypeError);
      });

      it("deletes rows by id", async () => {
        const asset = await givenAsset();
        const kept = await givenAsset();

        await expect(db.assets.delete([asset.id])).resolves.toEqual([asset]);
        await expect(db.assets.findById(asset.id)).resolves.toBeNull();
        await expect(db.assets.findById(kept.id)).resolves.toEqual(kept);
      });

      it("does nothing when deleting no ids", async () => {
        const asset = await givenAsset();

        await expect(db.assets.delete([])).resolves.toEqual([]);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("deletes every matching row and returns them", async () => {
        const asset = await givenAsset({ key: "gone" });
        await givenAsset({ key: "kept" });

        await expect(db.assets.deleteWhere({ key: "gone" })).resolves.toEqual([asset]);
        await expect(db.assets.findById(asset.id)).resolves.toBeNull();
      });

      it("does not delete when the filter is empty", async () => {
        const asset = await givenAsset();

        await expect(db.assets.deleteWhere({})).resolves.toEqual([]);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("returns no rows when a delete matches nothing", async () => {
        await givenAsset();

        await expect(db.assets.deleteWhere({ key: "missing" })).resolves.toEqual([]);
      });
    });

    describe("transactions", () => {
      it("reports the transactional context", async () => {
        const isInTransaction = await db.assets.transaction(
          async (context) => context.isInTransaction,
        );

        expect(isInTransaction).toBe(true);
      });

      it("binds the transactional copy as `this`", async () => {
        const asset = newAsset();

        await db.assets.transaction(async function () {
          expect(this).not.toBe(db.assets);
          expect(this.getContext().isInTransaction).toBe(true);

          await this.insert(asset);
        });

        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("commits writes made inside the transaction", async () => {
        const asset = newAsset();

        await db.assets.transaction(async (context) => {
          await db.assets.withContext(context).insert(asset);
        });

        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("rolls writes back with the transaction", async () => {
        const asset = newAsset();

        await expect(
          db.assets.transaction(async (context) => {
            await db.assets.withContext(context).insert(asset);
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        await expect(db.assets.findById(asset.id)).resolves.toBeNull();
      });

      it("rolls back only the nested scope that failed", async () => {
        const outer = newAsset();
        const inner = newAsset();

        await db.assets.transaction(async (context) => {
          await db.assets.withContext(context).insert(outer);

          await expect(
            db.assets.withContext(context).transaction(async (nested) => {
              await db.assets.withContext(nested).insert(inner);
              throw new Error("nested rollback");
            }),
          ).rejects.toThrow("nested rollback");
        });

        await expect(db.assets.findById(outer.id)).resolves.toEqual(outer);
        await expect(db.assets.findById(inner.id)).resolves.toBeNull();
      });

      it("rolls patches back with the transaction", async () => {
        const asset = await givenAsset({ size: 10 });

        await expect(
          db.assets.transaction(async (context) => {
            await db.assets.withContext(context).patch(asset.id, { size: 64 });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });
    });
  });
}
