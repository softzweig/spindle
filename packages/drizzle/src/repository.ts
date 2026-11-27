import {
  AbstractRepository,
  type Entity,
  type EntityFilter,
  type EntityId,
  type EntityInsert,
  type EntityPatch,
  type Paging,
  type RepositoryContext,
} from "@softzweig/spindle-core/repository";
import { TRANSACTION_EXECUTOR } from "@softzweig/spindle-core/transactional";
import {
  and,
  asc,
  type Column,
  desc,
  eq,
  getTableColumns,
  gt,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
  type Table,
} from "drizzle-orm";

/** A row as returned by a statement whose table type is only known generically. */
type Row = Record<string, unknown>;

/** A selected row set, with the limit step every dialect supports. */
interface SelectedTable {
  where(condition: SQL | undefined): PromiseLike<Row[]>;
  limit(count: number): { where(condition: SQL | undefined): PromiseLike<Row[]> };
}

/**
 * The builder a page reads: drizzle's own, narrowed to the steps that narrow, order and
 * limit. Reached through the cast in {@link AbstractDrizzleRepository.fetchPage} so the
 * shared port stays dialect-neutral; `orderBy` is overloaded per dialect, which is why the
 * shared shape cannot name it.
 */
interface PageQuery extends PromiseLike<Row[]> {
  where(condition: SQL | undefined): PageQuery;
  orderBy(...columns: (SQL | Column)[]): PageQuery;
  limit(count: number): PageQuery;
}

/**
 * The projection form of `select`, which every dialect's builder has.
 *
 * Every dialect's `select()` takes a projection, but naming it on
 * {@link DrizzleDatabase} would make the shared shape stricter than the
 * databases this package drives actually are.
 */
type ProjectingSelect = (projection: Record<string, SQL | Column>) => {
  from(table: Table): { where(condition: SQL | undefined): PromiseLike<Row[]> };
};

/**
 * The slice of a drizzle database this package drives.
 *
 * Deliberately structural and dialect-agnostic: drizzle has no cross-dialect
 * database base type, but every `drizzle()` instance, Postgres, MySQL or
 * SQLite, satisfies this shape, and so does a transaction handle.
 */
export interface DrizzleDatabase {
  select(): {
    from(table: Table): SelectedTable;
  };
  insert(table: Table): {
    values(values: Row): { returning(): PromiseLike<Row[]> };
  };
  update(table: Table): {
    set(values: Row): { where(condition: SQL): { returning(): PromiseLike<Row[]> } };
  };
  delete(table: Table): {
    where(condition: SQL): { returning(): PromiseLike<Row[]> };
  };
  transaction<T>(callback: (transaction: DrizzleDatabase) => Promise<T>): Promise<T>;
}

/** The context a drizzle repository passes to a transaction callback. */
export interface DrizzleContext extends RepositoryContext {
  /** The executor this context is bound to, the transaction handle. */
  readonly db: DrizzleDatabase;

  /** The same handle, in the slot a nested transaction runner reads back. */
  readonly [TRANSACTION_EXECUTOR]: DrizzleDatabase;
}

/**
 * One key of a paging order: the column compared, the direction it is walked in, and how
 * to read that column's value back out of a cursor.
 */
export type DrizzleCursorKey<TCursor> = Readonly<{
  column: Column;
  /** The part of `cursor` that is compared against {@link column}. */
  of(cursor: TCursor): unknown;
  direction?: "asc" | "desc";
}>;

/**
 * How a drizzle repository pages: the columns its order is built from, narrowest first, and
 * how a row becomes the cursor that resumes after it.
 *
 * `TCursor` defaults to the row id; a cursor that carries more, a timestamp paired with an
 * id for instance, is a type of its own and `read` has to match it.
 */
export type DrizzlePaging<TEntity extends Entity, TCursor = EntityId<TEntity>> = Paging<
  TEntity,
  TCursor
> &
  Readonly<{
    keys: readonly [DrizzleCursorKey<TCursor>, ...DrizzleCursorKey<TCursor>[]];
  }>;

/**
 * How a table may store when a row was written: a date, an ISO string or an epoch number.
 *
 * Each orders correctly in its own column, which is all paging asks of it.
 */
export type CreatedAtValue = Date | string | number;

/** An entity that records when it was written, which is what {@link pagingByCreatedAt} needs. */
type CreatedAtEntity = Entity & Readonly<{ createdAt: CreatedAtValue }>;

/** The cursor for paging newest first: when a row was written, and its id to break ties. */
export type CreatedAtCursor<TEntity extends CreatedAtEntity> = Readonly<{
  createdAt: TEntity["createdAt"];
  id: EntityId<TEntity>;
}>;

/**
 * The clause a keyset page narrows by: the first key past its value, or a tie on it and the
 * next key past its value, down to the last key. Comparing the keys in order keeps pages
 * from overlapping when the leading key repeats.
 */
function keysetAfter<TCursor>(
  keys: readonly DrizzleCursorKey<TCursor>[],
  cursor: TCursor,
): SQL | undefined {
  const [key, ...rest] = keys;
  if (!key) return undefined;

  const value = key.of(cursor);
  const past = key.direction === "desc" ? lt(key.column, value) : gt(key.column, value);
  const tail = keysetAfter(rest, cursor);
  if (!tail) return past;

  const tie = and(eq(key.column, value), tail);
  if (!tie) return past;

  return or(past, tie) ?? past;
}

/** The columns an order is built from, narrowest key first. */
function orderOf<TCursor>(keys: readonly DrizzleCursorKey<TCursor>[]): (SQL | Column)[] {
  return keys.map(({ column, direction }) => (direction === "desc" ? desc(column) : asc(column)));
}

/** The `id` column of a table, the key a repository pages by when it declares none. */
function idColumnOf(table: Table): Column {
  const column = (getTableColumns(table) as Record<string, Column>).id;

  if (!column) throw new TypeError('table has no "id" column to page by');

  return column;
}

/**
 * Paging by the row id, ascending.
 *
 * What a repository pages by when its entity is its own row, and a repository that pages by
 * something else passes its own {@link DrizzlePaging}.
 */
export const pagingById = <TEntity extends Entity>(
  table: Table,
): DrizzlePaging<TEntity, EntityId<TEntity>> => ({
  keys: [{ column: idColumnOf(table), of: (cursor) => cursor }],
  read: (entity) => entity.id,
});

/**
 * Paging newest first, the id breaking ties.
 *
 * What a table whose timestamps repeat needs: the timestamp orders the pages and the id
 * makes that order total, so two rows written in the same second cannot hide each other.
 */
export const pagingByCreatedAt = <TEntity extends CreatedAtEntity>(table: {
  readonly createdAt: Column;
  readonly id: Column;
}): DrizzlePaging<TEntity, CreatedAtCursor<TEntity>> => ({
  keys: [
    { column: table.createdAt, direction: "desc", of: (cursor) => cursor.createdAt },
    { column: table.id, direction: "desc", of: (cursor) => cursor.id },
  ],
  read: (entity) => ({ createdAt: entity.createdAt, id: entity.id }),
});

/**
 * Base for a drizzle-backed repository.
 *
 * Reads and writes are implemented once: filters become `where` clauses, rows
 * become entities, and `findById`/`findByIds`/`findOne` come from the core
 * abstraction. An adapter supplies the two mappers, the id filter and, when the id
 * is not what orders its pages, how its pages are ordered.
 *
 * The table is the first parameter and the entity defaults to its row type, so an
 * identity repository only has to name the table while a mapper-driven one names
 * both.
 */
export abstract class AbstractDrizzleRepository<
  TTable extends Table,
  TEntity extends Entity = Entity & InferSelectModel<TTable>,
  TFilter extends EntityFilter<TEntity, SQL> = EntityFilter<TEntity, SQL>,
  TCursor = EntityId<TEntity>,
> extends AbstractRepository<TEntity, DrizzleContext, TFilter, TCursor> {
  /** The table this repository reads and writes. */
  readonly table: TTable;

  /**
   * The keys its pages are ordered by, narrowest first.
   *
   * Only the keys are kept here: the reader belongs to the paging definition the base holds.
   */
  private readonly keys: readonly DrizzleCursorKey<TCursor>[];

  /**
   * @param db The executor the repository starts on.
   * @param table The table it reads and writes.
   * @param paging How pages are ordered and where they resume; {@link pagingById} for the
   *   common case.
   */
  constructor(db: DrizzleDatabase, table: TTable, paging: DrizzlePaging<TEntity, TCursor>) {
    super(
      { [TRANSACTION_EXECUTOR]: db, db, isInTransaction: false },
      (context, work) =>
        context.db.transaction((tx) =>
          work({ [TRANSACTION_EXECUTOR]: tx, db: tx, isInTransaction: true }),
        ),
      paging,
    );

    this.table = table;
    this.keys = paging.keys;
  }

  /** The executor this repository is bound to. */
  protected get db(): DrizzleDatabase {
    return this.context.db;
  }

  /** Maps a selected row to the domain entity. */
  protected abstract toDto(row: InferSelectModel<TTable>): TEntity;

  /** Maps an entity, or a part of it, to insertable column values. */
  protected abstract toRow(
    dto: Readonly<Partial<EntityInsert<TEntity>>>,
  ): Partial<InferInsertModel<TTable>>;

  /**
   * Turns ids into a filter.
   *
   * Abstract because `TFilter` may add required fields beyond `id`, so the base
   * class cannot construct one.
   */
  abstract override idFilter(ids: readonly EntityId<TEntity>[]): TFilter;

  override async findMany(filter: Readonly<TFilter & { limit?: number }>): Promise<TEntity[]> {
    const { limit, ...criteria } = filter;

    return this.toDtos(await this.select(this.where(criteria), limit));
  }

  /**
   * One page of rows, in the order the paging spec declares.
   *
   * @see {@link AbstractRepository.list}
   */
  protected override async fetchPage(
    filter: Readonly<TFilter> | undefined,
    cursor: TCursor | undefined,
    limit: number,
  ): Promise<TEntity[]> {
    const scoped = and(
      filter && this.where(filter),
      cursor === undefined ? undefined : keysetAfter(this.keys, cursor),
    );

    // Called on the database itself, not through a variable: the builder needs its receiver.
    const rows = await (this.db.select as unknown as () => { from(table: Table): PageQuery })()
      .from(this.source())
      .where(scoped)
      .orderBy(...orderOf(this.keys))
      .limit(limit);

    return this.toDtos(rows);
  }

  override async insert(dto: Readonly<EntityInsert<TEntity>>): Promise<TEntity> {
    const [row] = await this.db.insert(this.source()).values(this.toRow(dto)).returning();

    if (!row) throw new TypeError("insert returned no row");

    return this.toDto(row as InferSelectModel<TTable>);
  }

  override async patchWhere(
    filter: Readonly<TFilter>,
    patch: EntityPatch<TEntity>,
  ): Promise<TEntity[]> {
    const sqlFilter = this.where(filter);
    if (!sqlFilter) return [];

    const rows = await this.db
      .update(this.source())
      .set(this.toRow(patch))
      .where(sqlFilter)
      .returning();

    return this.toDtos(rows);
  }

  override async deleteWhere(filter: Readonly<TFilter>): Promise<TEntity[]> {
    const sqlFilter = this.where(filter);
    if (!sqlFilter) return [];

    const rows = await this.db.delete(this.source()).where(sqlFilter).returning();

    return this.toDtos(rows);
  }

  /** Counts the rows matching `filter` in the database, without loading them. */
  override async count(filter: Readonly<TFilter>): Promise<number> {
    // Called on the database itself, not through a variable: the builder needs its receiver.
    const from = (this.db.select as unknown as ProjectingSelect)({
      count: sql`count(*)`,
    }).from(this.source());
    const [row] = await from.where(this.where(filter));

    // A driver returns `count` as a bigint string, so it is coerced here rather than everywhere.
    return Number(row?.count ?? 0);
  }

  /**
   * Translates the property filter, requiring every key to map to a column.
   *
   * Public so a custom statement can reuse the same filter semantics as the
   * inherited reads instead of rebuilding them.
   *
   * @human
   */
  where(filter: Readonly<Record<string, unknown>>): SQL | undefined {
    const columns = getTableColumns(this.table) as Record<string, Column>;

    return and(
      ...Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .map(([property, value]) => {
          const column = columns[property];
          if (!column) throw new TypeError(`filter property "${property}" has no column mapping`);
          if (value === null) return isNull(column);
          return Array.isArray(value) ? inArray(column, value) : eq(column, value);
        }),
    );
  }

  /**
   * The table as a plain {@link Table}.
   *
   * `TTable` narrows the mapper types; handing the unresolved generic to
   * drizzle's builders trips a conditional type that only resolves for concrete
   * tables.
   */
  protected source(): Table {
    return this.table;
  }

  /** Selects rows, re-typing them from the widened table to the mapper's row type. */
  protected async select(
    condition: SQL | undefined,
    limit?: number,
  ): Promise<InferSelectModel<TTable>[]> {
    const table = this.db.select().from(this.source());
    const rows =
      limit != null ? await table.limit(limit).where(condition) : await table.where(condition);
    return rows as InferSelectModel<TTable>[];
  }

  protected toDtos(rows: Row[]): TEntity[] {
    return rows.map((row) => this.toDto(row as InferSelectModel<TTable>));
  }
}
