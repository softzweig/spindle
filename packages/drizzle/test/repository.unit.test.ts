import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import { type AssetFilter, AssetRepository, type AssetRow } from "./support/assets.js";

type Query = { sql: string; params: unknown[] };

const row: AssetRow = { id: "a_1", key: "assets/a.png", size: 42, note: null };

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
    data.map(({ id, key, size, note }) => [id, key, size, note]),
  );

  return { repository: new AssetRepository(db), queries };
};

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
        repository.insert({ id: "a_1", key: "assets/a.png", size: 42, note: null }),
      ).resolves.toEqual(row);

      expect(queries[0]?.sql).toContain('insert into "assets"');
      expect(queries[0]?.params).toEqual(["assets/a.png", 42, null]);
    });

    it("rejects an insert the driver returns no row for", async () => {
      const repository = new AssetRepository(createProxy([], () => []));

      await expect(
        repository.insert({ key: "assets/a.png", size: 42, note: null }),
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
});
