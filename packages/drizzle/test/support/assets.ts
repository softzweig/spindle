import { randomUUID } from "node:crypto";
import type { EntityFilter, EntityId, EntityInsert } from "@softzweig/spindle-core/repository";
import type { SQL } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { AbstractDrizzleRepository } from "../../src/repository.js";

export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
  note: text("note"),
});

export const assetsDdl =
  'create table "assets" ("id" text primary key, "key" text not null, "size" integer not null, "note" text)';

export type AssetRow = typeof assets.$inferSelect;
export type Asset = {
  readonly id: string;
  readonly key: string;
  readonly size: number;
  /** Nullable, so a filter on it exercises the `is null` branch. */
  readonly note: string | null;
};
export type AssetFilter = EntityFilter<Asset, SQL>;

/**
 * A filter that also requires `size`.
 *
 * The shape a repository narrows to when only part of the entity identifies a
 * row; it is what the contract's `assetsBySize` repository is typed with.
 */
export type AssetSizeFilter = EntityFilter<Asset, SQL> & { readonly size: number };

export const newAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: randomUUID(),
  key: `assets/${randomUUID()}`,
  size: 42,
  note: null,
  ...overrides,
});

export class AssetRepository extends AbstractDrizzleRepository<typeof assets, Asset, AssetFilter> {
  readonly table = assets;

  protected toDto(row: AssetRow): Asset {
    return { id: row.id, key: row.key, size: row.size, note: row.note };
  }

  protected toRow(dto: Readonly<Partial<EntityInsert<Asset>>>): Partial<AssetRow> {
    return { key: dto.key, size: dto.size, note: dto.note };
  }

  override idFilter(ids: readonly EntityId<Asset>[]): AssetFilter {
    return { id: [...ids] };
  }
}
