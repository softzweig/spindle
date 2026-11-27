import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EntityFilter, Repository, RepositoryContext } from "../../src/repository/index.js";
import { SpindleErrorCode } from "../../src/result.js";

/**
 * The fixture every adapter is held to: a set of rows with UUIDv4 ids and a timestamp that
 * repeats, so a cursor made of either alone would lose rows.
 */
export type Asset = {
  readonly id: string;
  readonly key: string;
  readonly size: number;
  /** Nullable, so a filter on it exercises the `is null` branch. */
  readonly note: string | null;
  readonly createdAt: Date;
};

export type AssetFilter = EntityFilter<Asset>;

/** A filter that also requires `size`, the shape a repository can narrow to. */
export type AssetSizeFilter = EntityFilter<Asset> & { readonly size: number };

/** The timestamp a row was written at, and its id: a cursor that survives repeated stamps. */
export type AssetCursor = { readonly createdAt: Date; readonly id: string };

export const newAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: randomUUID(),
  key: `assets/${randomUUID()}`,
  size: 42,
  note: null,
  // Whole seconds, so a dialect that stores timestamps as integers round-trips it.
  createdAt: new Date(Math.floor(Date.now() / 1000) * 1000),
  ...overrides,
});

/** The repositories a backend has to provide for the contract to run. */
export type RepositoryContract<TContext extends RepositoryContext> = {
  readonly assets: Repository<Asset, TContext, AssetFilter>;
  /** The same set, read through a filter that requires `size`. */
  readonly assetsBySize: Repository<Asset, TContext, AssetSizeFilter>;
  /** The same set, paged newest first: the timestamp orders and the id breaks ties. */
  readonly assetsNewest: Repository<Asset, TContext, AssetFilter, AssetCursor>;
  /** Empties the set between tests. */
  reset(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Behavior every repository must share, whichever backend it wraps.
 *
 * The same expectations run against the SQL adapters and against the in-memory one, so a
 * difference in what callers get back shows up as a failing test in both packages rather
 * than as a surprise in production.
 */
export function describeRepositoryContract<TContext extends RepositoryContext>(
  name: string,
  create: () => Promise<RepositoryContract<TContext>>,
) {
  describe(name, () => {
    let db: RepositoryContract<TContext>;

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

      // The row is inserted first: an in-memory repository can only check a property it can
      // see on a row, while SQL resolves the filter against its schema before querying.
      it("rejects a filter property the rows do not have", async () => {
        await givenAsset();

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

    describe("pagination", () => {
      const byId = (rows: Asset[]) =>
        [...rows].sort((left, right) => (left.id < right.id ? -1 : 1));

      it("returns the first page and the cursor that continues it", async () => {
        const rows = byId([await givenAsset(), await givenAsset(), await givenAsset()]);

        const page = await db.assets.list({ limit: 2 });

        expect(page.items).toEqual(rows.slice(0, 2));
        expect(page.nextCursor).toBe(rows[1]?.id);
      });

      it("walks to the end without repeating or skipping a row", async () => {
        const rows = byId([
          await givenAsset(),
          await givenAsset(),
          await givenAsset(),
          await givenAsset(),
        ]);

        const seen: Asset[] = [];
        let nextCursor: string | null = null;

        do {
          const page = await db.assets.list({
            limit: 2,
            cursor: nextCursor ?? undefined,
          });

          seen.push(...page.items);
          nextCursor = page.nextCursor;
        } while (nextCursor !== null);

        expect(ids(seen)).toEqual(ids(rows));
      });

      it("returns no cursor for the last page", async () => {
        await givenAsset();

        await expect(db.assets.list({ limit: 5 })).resolves.toMatchObject({ nextCursor: null });
      });

      it("returns an empty page when nothing matches", async () => {
        await givenAsset();

        await expect(db.assets.list({ limit: 5, filter: { size: 999 } })).resolves.toEqual({
          items: [],
          nextCursor: null,
        });
      });

      it("applies the filter before paging", async () => {
        const matching = byId([await givenAsset({ size: 10 }), await givenAsset({ size: 10 })]);
        await givenAsset({ size: 20 });

        const page = await db.assets.list({ limit: 1, filter: { size: 10 } });

        expect(page.items).toEqual([matching[0]]);
        expect(page.nextCursor).toBe(matching[0]?.id);
      });
    });

    describe("pagination by timestamp and id", () => {
      const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

      /** Newest first, the id breaking ties: the order `assetsNewest` pages in. */
      const newestFirst = (rows: Asset[]) =>
        [...rows].sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1),
        );

      /** Every row the repository hands out, page by page; bounded so a stuck cursor fails. */
      const walk = async (limit: number) => {
        const seen: Asset[] = [];
        let cursor: AssetCursor | undefined;

        for (let pages = 0; pages < 10; pages++) {
          const { items, nextCursor } = await db.assetsNewest.list({ limit, cursor });
          seen.push(...items);

          if (nextCursor === null) return seen;

          cursor = nextCursor;
        }

        throw new Error("paging did not advance");
      };

      it("returns the newest rows and a cursor carrying both parts", async () => {
        await givenAsset({ createdAt: at(1) });
        const newer = await givenAsset({ createdAt: at(2) });
        const newest = await givenAsset({ createdAt: at(3) });

        const page = await db.assetsNewest.list({ limit: 2 });

        expect(page.items).toEqual([newest, newer]);
        expect(page.nextCursor).toEqual({ createdAt: newer.createdAt, id: newer.id });
      });

      it("breaks a timestamp tie with the id instead of skipping a row", async () => {
        const createdAt = at(5);
        const rows = newestFirst([
          await givenAsset({ createdAt }),
          await givenAsset({ createdAt }),
          await givenAsset({ createdAt }),
        ]);

        expect(await walk(2)).toEqual(rows);
      });

      it("walks repeated timestamps in order, every row once", async () => {
        const rows = newestFirst([
          await givenAsset({ createdAt: at(3) }),
          await givenAsset({ createdAt: at(1) }),
          await givenAsset({ createdAt: at(3) }),
          await givenAsset({ createdAt: at(2) }),
          await givenAsset({ createdAt: at(3) }),
        ]);

        expect(await walk(2)).toEqual(rows);
      });

      it("pages a filtered set in the same order", async () => {
        const createdAt = at(7);
        const matching = newestFirst([
          await givenAsset({ createdAt, size: 10 }),
          await givenAsset({ createdAt, size: 10 }),
        ]);
        await givenAsset({ createdAt: at(8), size: 20 });

        const page = await db.assetsNewest.list({ limit: 1, filter: { size: 10 } });

        expect(page.items).toEqual([matching[0]]);
        expect(page.nextCursor).toEqual({ createdAt, id: matching[0]?.id });
      });

      it("keeps walking when rows change behind the cursor", async () => {
        const cursorRow = await givenAsset({ createdAt: at(2) });
        const next = await givenAsset({ createdAt: at(1) });

        const first = await db.assetsNewest.list({ limit: 1 });
        expect(first.items).toEqual([cursorRow]);

        // A newer row sorts before the cursor, so this walk must not serve it; an older one
        // is still reachable, and the cursor row itself no longer has to exist.
        const newer = await givenAsset({ createdAt: at(3) });
        const older = await givenAsset({ createdAt: at(0) });
        await db.assetsNewest.delete([cursorRow.id]);

        const rest = await db.assetsNewest.list({
          limit: 5,
          cursor: first.nextCursor ?? undefined,
        });

        expect(rest.items).toEqual([next, older]);
        expect(rest.items).not.toContainEqual(newer);
      });
    });

    describe("writes", () => {
      it("inserts and reads the row", async () => {
        const asset = newAsset();

        await expect(db.assets.insert(asset)).resolves.toEqual(asset);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("rejects inserting an id that already exists", async () => {
        const asset = await givenAsset();

        const error = await db.assets.insert(asset).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({
          name: "RepositoryError",
          code: SpindleErrorCode.CONFLICT,
        });
        await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
      });

      it("patches one row by id", async () => {
        const asset = await givenAsset();
        const patched = { ...asset, size: 64 };

        await expect(db.assets.patch(asset.id, { size: 64 })).resolves.toEqual(patched);
        await expect(db.assets.findById(asset.id)).resolves.toEqual(patched);
      });

      it("rejects patching an unknown id with a not found repository error", async () => {
        const error = await db.assets
          .patch("missing", { size: 64 })
          .catch((thrown: unknown) => thrown);

        // Matched by shape rather than by class: this file is imported into adapters that run
        // against the built package, so asserting the class object would compare two copies.
        expect(error).toMatchObject({
          name: "RepositoryError",
          code: SpindleErrorCode.NOT_FOUND,
          details: { id: "missing" },
        });
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

      it("rejects a patch filter property the rows do not have", async () => {
        await givenAsset();

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
    });
  });
}
