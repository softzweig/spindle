import type { EntityFilter, EntityId, EntityInsert } from "@softzweig/spindle-core/repository";
import type { SQL } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { Asset } from "../../../core/test/contract/repository.contract.js";
import {
  AbstractDrizzleRepository,
  type DrizzleDatabase,
  pagingById,
} from "../../src/repository.js";

export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const assetsDdl =
  'create table "assets" ("id" text primary key, "key" text not null, "size" integer not null, "note" text, "created_at" timestamp not null)';

export type AssetRow = typeof assets.$inferSelect;

/** Drizzle filters may also carry raw SQL, which is what its `sql` extension value is. */
export type AssetFilter = EntityFilter<Asset, SQL>;

/** A filter that also requires `size`, the shape a repository can narrow to. */
export type AssetSizeFilter = EntityFilter<Asset, SQL> & { readonly size: number };

export class AssetRepository extends AbstractDrizzleRepository<typeof assets, Asset, AssetFilter> {
  constructor(db: DrizzleDatabase) {
    super(db, assets, pagingById(assets));
  }

  protected toDto(row: AssetRow): Asset {
    return { id: row.id, key: row.key, size: row.size, note: row.note, createdAt: row.createdAt };
  }

  protected toRow(dto: Readonly<Partial<EntityInsert<Asset>>>): Partial<AssetRow> {
    return { key: dto.key, size: dto.size, note: dto.note, createdAt: dto.createdAt };
  }

  override idFilter(ids: readonly EntityId<Asset>[]): AssetFilter {
    return { id: [...ids] };
  }
}
