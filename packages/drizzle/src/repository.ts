import {
  AbstractRepository,
  type Entity,
  type EntityFilter,
  type EntityId,
  type EntityInsert,
  type EntityPatch,
  type RepositoryContext,
} from "@softzweig/spindle-core/repository";
import { TRANSACTION_EXECUTOR } from "@softzweig/spindle-core/transactional";
import {
  and,
  type Column,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  isNull,
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
 * Base for a drizzle-backed repository.
 *
 * Reads and writes are implemented once: filters become `where` clauses, rows
 * become entities, and `findById`/`findByIds`/`findOne` come from the core
 * abstraction. An adapter supplies the table, the two mappers and the id filter.
 *
 * The table is the first parameter and the entity defaults to its row type, so an
 * identity repository only has to name the table while a mapper-driven one names
 * both.
 */
export abstract class AbstractDrizzleRepository<
  TTable extends Table,
  TEntity extends Entity = Entity & InferSelectModel<TTable>,
  TFilter extends EntityFilter<TEntity, SQL> = EntityFilter<TEntity, SQL>,
> extends AbstractRepository<TEntity, DrizzleContext, TFilter> {
  constructor(db: DrizzleDatabase) {
    super({ [TRANSACTION_EXECUTOR]: db, db, isInTransaction: false }, (context, work) =>
      context.db.transaction((tx) =>
        work({ [TRANSACTION_EXECUTOR]: tx, db: tx, isInTransaction: true }),
      ),
    );
  }

  /** The executor this repository is bound to. */
  protected get db(): DrizzleDatabase {
    return this.context.db;
  }

  /** The table this repository reads and writes. */
  abstract readonly table: TTable;

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
