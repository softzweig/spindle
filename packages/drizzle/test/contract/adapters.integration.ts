import type { Repository } from "@softzweig/spindle-core/repository";
import {
  TRANSACTION_EXECUTOR,
  type TransactionalContext,
} from "@softzweig/spindle-core/transactional";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleAdapters } from "../../src/adapters.js";
import type { DrizzleContext } from "../../src/repository.js";
import { type Asset, type AssetFilter, newAsset } from "../support/assets.js";

type AssetRepository = Repository<Asset, DrizzleContext, AssetFilter>;

type Repositories = { readonly assets: AssetRepository; readonly mirror: AssetRepository };

export type TestAdapters = {
  readonly adapters: DrizzleAdapters<Repositories>;
  readonly assets: AssetRepository;
  readonly mirror: AssetRepository;
  reset(): Promise<void>;
  close(): Promise<void>;
};

/** Adapter behavior every dialect must share, run against a real database. */
export function describeAdapters(name: string, create: () => Promise<TestAdapters>) {
  describe(name, () => {
    let db: TestAdapters;

    beforeAll(async () => {
      db = await create();
    });

    afterAll(async () => {
      await db.close();
    });

    beforeEach(async () => {
      await db.reset();
    });

    it("exposes the repository map it was wired with", () => {
      expect(db.adapters.repositories.assets).toBe(db.assets);
      expect(db.adapters.repositories.mirror).toBe(db.mirror);
    });

    it("runs work on a transaction and rebinds the map", async () => {
      const asset = newAsset();

      const result = await db.adapters.transaction({ isInTransaction: false }, async (context) => {
        expect(context.isInTransaction).toBe(true);
        expect(context.db).toBe(context[TRANSACTION_EXECUTOR]);
        expect(context.assets).not.toBe(db.assets);
        expect(context.mirror).not.toBe(db.mirror);
        expect(context.assets.getContext().db).toBe(context.db);
        expect(context.mirror.getContext().db).toBe(context.db);

        await context.assets.insert(asset);

        return 42;
      });

      expect(result).toBe(42);
      await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
    });

    it("rolls back when work throws", async () => {
      const asset = newAsset();

      await expect(
        db.adapters.transaction({ isInTransaction: false }, async (context) => {
          await context.assets.insert(asset);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      await expect(db.assets.findById(asset.id)).resolves.toBeNull();
    });

    it("nests on the handle already in play", async () => {
      const outer = newAsset();
      const inner = newAsset();

      await db.adapters.transaction({ isInTransaction: false }, async (context) => {
        await context.assets.insert(outer);

        await expect(
          db.adapters.transaction(context, async (nested) => {
            await nested.assets.insert(inner);
            throw new Error("nested rollback");
          }),
        ).rejects.toThrow("nested rollback");
      });

      await expect(db.assets.findById(outer.id)).resolves.toEqual(outer);
      await expect(db.assets.findById(inner.id)).resolves.toBeNull();
    });

    it("falls back to the root handle when the binding is not a drizzle handle", async () => {
      // A context from another transactional system carries an executor of its
      // own kind, which the adapter has to ignore instead of nesting on it.
      const foreignHandle = {};
      const foreign = {
        isInTransaction: true,
        [TRANSACTION_EXECUTOR]: foreignHandle,
      } as unknown as TransactionalContext;
      const asset = newAsset();

      await db.adapters.transaction(foreign, async (context) => {
        expect(context.db).not.toBe(foreignHandle);

        await context.assets.insert(asset);
      });

      await expect(db.assets.findById(asset.id)).resolves.toEqual(asset);
    });
  });
}
