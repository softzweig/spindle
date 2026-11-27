import type { EntityFilter, EntityId, EntityInsert } from "@softzweig/spindle-core/repository";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Asset } from "../../core/test/contract/repository.contract.js";
import {
  AbstractDrizzleRepository,
  type CreatedAtCursor,
  type DrizzleDatabase,
  pagingByCreatedAt,
  pagingById,
} from "../src/repository.js";
import { type AssetFilter, AssetRepository, type AssetRow, assets } from "./support/assets.js";

type Query = { sql: string; params: unknown[] };

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const row: AssetRow = { id: "a_1", key: "assets/a.png", size: 42, note: null, createdAt };

/** A pg-proxy connection that records the statements it runs and answers with `answer`. */
const createProxy = (queries: Query[], answer: () => unknown[][]) =>
  drizzle(async (sql, params) => {
    queries.push({ sql, params });

    // pg-proxy reads rows positionally, in the order of the selected columns.
    return { rows: answer() };
  });

/** A repository over a pg-proxy connection, recording the SQL it emits. */
const createRepository = (data: readonly AssetRow[] = [row]) => {
  const queries: Query[] = [];
  const db = createProxy(queries, () =>
    data.map(({ id, key, size, note, createdAt }) => [id, key, size, note, createdAt]),
  );

  return { repository: new AssetRepository(db), queries };
};

/**
 * Newest first, the id breaking ties: the shape a repository takes when timestamps repeat
 * and the id alone does not order what pages walk.
 */
class NewestRepository extends AbstractDrizzleRepository<
  typeof assets,
  Asset,
  AssetFilter,
  CreatedAtCursor<Asset>
> {
  constructor(db: DrizzleDatabase) {
    super(db, assets, pagingByCreatedAt(assets));
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

/** A table that records when a row was written as an ISO string instead of a timestamp. */
const events = pgTable("events", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

type Event = { readonly id: string; readonly createdAt: string };
type EventRow = typeof events.$inferSelect;

/** Newest first over a text timestamp: the same helper, the ordering left to the column. */
class EventRepository extends AbstractDrizzleRepository<
  typeof events,
  Event,
  EntityFilter<Event, SQL>,
  CreatedAtCursor<Event>
> {
  constructor(db: DrizzleDatabase) {
    super(db, events, pagingByCreatedAt(events));
  }

  protected toDto(row: EventRow): Event {
    return row;
  }

  protected toRow(dto: Readonly<Partial<EntityInsert<Event>>>): Partial<EventRow> {
    return dto;
  }

  override idFilter(ids: readonly EntityId<Event>[]): EntityFilter<Event, SQL> {
    return { id: [...ids] };
  }
}

describe("AbstractDrizzleRepository", () => {
  describe("reads", () => {
    it("selects through the table and maps rows to entities", async () => {
      const { repository } = createRepository();

      await expect(repository.findMany({})).resolves.toEqual([row]);
    });

    it("reads a row by id through the id filter", async () => {
      const { repository, queries } = createRepository();

      await repository.findById("a_1");

      expect(queries[0]?.sql).toContain('from "assets"');
      expect(queries[0]?.sql).toContain('"assets"."id" in ($1)');
      expect(queries[0]?.params).toEqual(["a_1"]);
    });

    it("reads many rows with an in clause", async () => {
      const { repository, queries } = createRepository();

      await repository.findByIds(["a_1", "a_2"]);

      expect(queries[0]?.sql).toContain('"assets"."id" in ($1, $2)');
      expect(queries[0]?.params).toEqual(["a_1", "a_2"]);
    });

    it("maps array filter values to an in clause", async () => {
      const { repository, queries } = createRepository();

      await repository.findMany({ key: ["assets/a.png"] });

      expect(queries[0]?.sql).toContain('"assets"."key" in ($1)');
    });

    it("maps scalar filter values to an equality clause", async () => {
      const { repository, queries } = createRepository();

      await repository.findMany({ size: 42 });

      expect(queries[0]?.sql).toContain('"assets"."size" = $1');
      expect(queries[0]?.params).toEqual([42]);
    });

    it("passes a sql filter value through unbound", async () => {
      const { repository, queries } = createRepository();

      await repository.findMany({ key: sql`lower('A.PNG')` });

      expect(queries[0]?.sql).toContain('"assets"."key" = lower(\'A.PNG\')');
      expect(queries[0]?.params).toEqual([]);
    });

    it("applies a limit", async () => {
      const { repository, queries } = createRepository();

      await repository.findMany({ limit: 1 });

      expect(queries[0]?.sql).toContain("limit $1");
      expect(queries[0]?.params).toEqual([1]);
    });

    it("rejects a filter property without a column", async () => {
      const { repository } = createRepository();

      await expect(repository.findMany({ nope: "x" } as unknown as AssetFilter)).rejects.toThrow(
        TypeError,
      );
    });

    it("does not query for an empty id list", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.findByIds([])).resolves.toEqual([]);
      expect(queries).toEqual([]);
    });

    it("counts rows in one statement", async () => {
      const queries: Query[] = [];
      const repository = new AssetRepository(createProxy(queries, () => [[2]]));

      await expect(repository.count({})).resolves.toBe(2);
      expect(queries[0]?.sql).toContain("count(*)");
    });

    it("counts zero when the driver returns no row", async () => {
      const repository = new AssetRepository(createProxy([], () => []));

      await expect(repository.count({})).resolves.toBe(0);
    });
  });

  describe("writes", () => {
    it("inserts and maps the returned row", async () => {
      const { repository, queries } = createRepository();

      await expect(
        repository.insert({ id: "a_1", key: "assets/a.png", size: 42, note: null, createdAt }),
      ).resolves.toEqual(row);

      expect(queries[0]?.sql).toContain('insert into "assets"');
      expect(queries[0]?.params).toEqual(["assets/a.png", 42, null, createdAt.toISOString()]);
    });

    it("rejects an insert the driver returns no row for", async () => {
      const repository = new AssetRepository(createProxy([], () => []));

      await expect(
        repository.insert({ key: "assets/a.png", size: 42, note: null, createdAt }),
      ).rejects.toThrow(TypeError);
    });

    it("patches by id and maps the returned row", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.patch("a_1", { size: 64 })).resolves.toEqual(row);

      expect(queries[0]?.sql).toContain('update "assets" set');
      expect(queries[0]?.sql).toContain('"assets"."id" in ($2)');
      expect(queries[0]?.params).toEqual([64, "a_1"]);
    });

    it("patches every row matching a filter", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.patchWhere({ size: 42 }, { size: 64 })).resolves.toEqual([row]);

      expect(queries).toHaveLength(1);
      expect(queries[0]?.sql).toContain('update "assets" set');
      expect(queries[0]?.sql).toContain('"assets"."size" = $2');
      expect(queries[0]?.params).toEqual([64, 42]);
    });

    it("does not patch when the filter is empty", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.patchWhere({}, { size: 64 })).resolves.toEqual([]);

      expect(queries).toEqual([]);
    });

    it("deletes by ids and returns them", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.delete(["a_1", "a_2"])).resolves.toEqual([row]);

      expect(queries[0]?.sql).toContain('delete from "assets"');
      expect(queries[0]?.sql).toContain('"assets"."id" in ($1, $2)');
      expect(queries[0]?.params).toEqual(["a_1", "a_2"]);
    });

    it("deletes every row matching a filter and returns them", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.deleteWhere({ size: 42 })).resolves.toEqual([row]);

      expect(queries[0]?.sql).toContain('delete from "assets"');
      expect(queries[0]?.sql).toContain('"assets"."size" = $1');
      expect(queries[0]?.sql).toContain("returning");
      expect(queries[0]?.params).toEqual([42]);
    });

    it("does not query when deleting nothing", async () => {
      const { repository, queries } = createRepository();

      await expect(repository.delete([])).resolves.toEqual([]);
      await expect(repository.deleteWhere({})).resolves.toEqual([]);

      expect(queries).toEqual([]);
    });
  });

  describe("pagination", () => {
    const asRows = (data: readonly AssetRow[]) =>
      data.map(({ id, key, size, note, createdAt }) => [id, key, size, note, createdAt]);

    it("orders by id and asks for one row more than the page", async () => {
      const { repository, queries } = createRepository();

      await repository.list({ limit: 2 });

      expect(queries[0]?.sql).toContain('order by "assets"."id"');
      expect(queries[0]?.sql).not.toContain('"assets"."id" >');
      expect(queries[0]?.sql).toContain("limit $1");
      expect(queries[0]?.params).toEqual([3]);
    });

    it("continues strictly after the cursor", async () => {
      const { repository, queries } = createRepository([row, row]);

      const page = await repository.list({ limit: 1, cursor: "a_1" });

      expect(queries[0]?.sql).toContain('"assets"."id" > $1');
      expect(queries[0]?.params).toEqual(["a_1", 2]);
      expect(page.nextCursor).toBe(row.id);
    });

    it("scopes the cursor by the filter too", async () => {
      const { repository, queries } = createRepository([row, row]);

      await repository.list({ limit: 1, cursor: "a_1", filter: { size: 42 } });

      expect(queries[0]?.sql).toContain('"assets"."size" = $1');
      expect(queries[0]?.sql).toContain('"assets"."id" > $2');
      expect(queries[0]?.params).toEqual([42, "a_1", 2]);
    });

    it("returns no cursor when the page is the last one", async () => {
      const { repository } = createRepository([row]);

      await expect(repository.list({ limit: 5 })).resolves.toEqual({
        items: [row],
        nextCursor: null,
      });
    });

    it("pages newest first with a timestamp and id cursor", async () => {
      const second: AssetRow = { ...row, id: "a_2", createdAt: new Date("2026-01-01T00:00:01Z") };
      const queries: Query[] = [];
      const repository = new NewestRepository(createProxy(queries, () => asRows([row, second])));

      const page = await repository.list({ limit: 1, cursor: { createdAt, id: "a_2" } });

      expect(queries[0]?.sql).toContain('order by "assets"."created_at" desc, "assets"."id" desc');
      expect(queries[0]?.sql).toContain('"assets"."created_at" < $1');
      expect(queries[0]?.sql).toContain('"assets"."id" < $3');
      expect(queries[0]?.params).toEqual([
        createdAt.toISOString(),
        createdAt.toISOString(),
        "a_2",
        2,
      ]);
      expect(page.items).toEqual([row]);
      expect(page.nextCursor).toEqual({ createdAt, id: "a_1" });
    });

    it("pages newest first when createdAt is stored as text", async () => {
      const queries: Query[] = [];
      const repository = new EventRepository(
        createProxy(queries, () => [
          ["e_1", "2026-01-01T00:00:00.000Z"],
          ["e_0", "2025-12-31T00:00:00.000Z"],
        ]),
      );

      const page = await repository.list({
        limit: 1,
        cursor: { createdAt: "2026-01-02T00:00:00.000Z", id: "e_2" },
      });

      expect(queries[0]?.sql).toContain('order by "events"."created_at" desc, "events"."id" desc');
      expect(queries[0]?.params).toEqual([
        "2026-01-02T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
        "e_2",
        2,
      ]);
      expect(page.nextCursor).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", id: "e_1" });
    });

    it("rejects a default cursor on a table without an id column", () => {
      const keys = pgTable("keys", { key: text("key").notNull() });
      type KeyRow = typeof keys.$inferSelect;

      class KeyRepository extends AbstractDrizzleRepository<
        typeof keys,
        Asset,
        EntityFilter<Asset, SQL>,
        string
      > {
        constructor(db: DrizzleDatabase) {
          super(db, keys, pagingById(keys));
        }

        protected toDto(selected: KeyRow): Asset {
          return { ...selected, id: selected.key, size: 0, note: null, createdAt };
        }

        protected toRow(dto: Readonly<Partial<EntityInsert<Asset>>>): Partial<KeyRow> {
          return { key: dto.key };
        }

        override idFilter(ids: readonly EntityId<Asset>[]): EntityFilter<Asset, SQL> {
          return { id: [...ids] };
        }
      }

      expect(() => new KeyRepository(createProxy([], () => []))).toThrow(
        'table has no "id" column',
      );
    });
  });
});
