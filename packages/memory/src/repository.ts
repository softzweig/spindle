import { randomUUID } from "node:crypto";
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
import { MemoryStore } from "./store.js";

/** The context a memory repository passes to a transaction callback. */
export interface MemoryContext<TEntity extends Entity = Entity> extends RepositoryContext {
  /** The store this context is bound to. */
  readonly store: MemoryStore<TEntity>;

  /** The same store, in the slot a transaction runner reads back. */
  readonly [TRANSACTION_EXECUTOR]: MemoryStore<TEntity>;
}

/**
 * How an in-memory repository pages: the cursor of a row and, when those cursors do not
 * order themselves, how two of them compare.
 */
export type MemoryPaging<TEntity extends Entity, TCursor = EntityId<TEntity>> = Paging<
  TEntity,
  TCursor
> &
  Readonly<{
    /** Orders two cursors, negative when `left` comes first; scalars order themselves. */
    compare?(left: TCursor, right: TCursor): number;
  }>;

/**
 * How a row may record when it was written: a date, an ISO string or an epoch number.
 *
 * Each orders correctly among its own kind, which is all paging asks of it.
 */
export type CreatedAtValue = Date | string | number;

/** The cursor for paging newest first: when a row was written, and its id to break ties. */
export type CreatedAtCursor<TEntity extends Entity & Readonly<{ createdAt: CreatedAtValue }>> =
  Readonly<{
    createdAt: TEntity["createdAt"];
    id: EntityId<TEntity>;
  }>;

/**
 * A repository over rows held in process memory.
 *
 * Ephemeral by design: everything is gone when the process is, so this is meant
 * for tests and for wiring a service before a real store exists. Filters follow
 * the same rules as the SQL adapters, a scalar matches equality, an array matches
 * membership, `null` matches a null or absent value, and an undefined value is
 * ignored. Writes with no clause in their filter match nothing, again like the SQL
 * adapters, so a forgotten filter cannot take the whole store with it.
 *
 * A transaction snapshots the store it is bound to. Repositories constructed on
 * the same store share their rows and their rollbacks; repositories on separate
 * stores are independent.
 */
export class MemoryRepository<
  TEntity extends Entity,
  TFilter extends EntityFilter<TEntity> = EntityFilter<TEntity>,
  TCursor = EntityId<TEntity>,
> extends AbstractRepository<TEntity, MemoryContext<TEntity>, TFilter, TCursor> {
  /** Orders two cursors; {@link compareValues} unless the paging supplies one. */
  private readonly compare: (left: TCursor, right: TCursor) => number;

  /**
   * A repository that pages by id, the ordering every entity is guaranteed to have.
   *
   * @param store The store it starts on; a fresh one when omitted.
   */
  static byId<
    TEntity extends Entity,
    TFilter extends EntityFilter<TEntity> = EntityFilter<TEntity>,
  >(store?: MemoryStore<TEntity>): MemoryRepository<TEntity, TFilter> {
    return new MemoryRepository<TEntity, TFilter>({ read: (entity) => entity.id }, store);
  }

  /**
   * A repository that pages newest first, the id breaking ties.
   *
   * What a set whose timestamps repeat needs: the timestamp orders the pages and the id
   * makes that order total, so two rows written at the same time cannot hide each other.
   *
   * @param store The store it starts on; a fresh one when omitted.
   */
  static byCreatedAt<
    TEntity extends Entity & Readonly<{ createdAt: CreatedAtValue }>,
    TFilter extends EntityFilter<TEntity> = EntityFilter<TEntity>,
  >(store?: MemoryStore<TEntity>): MemoryRepository<TEntity, TFilter, CreatedAtCursor<TEntity>> {
    return new MemoryRepository<TEntity, TFilter, CreatedAtCursor<TEntity>>(
      {
        read: (entity) => ({ createdAt: entity.createdAt, id: entity.id }),
        compare: (left, right) =>
          compareValues(right.createdAt, left.createdAt) || compareValues(right.id, left.id),
      },
      store,
    );
  }

  /**
   * @param paging How pages are ordered and where they resume.
   * @param store The store the repository starts on; a fresh one when omitted.
   */
  constructor(
    paging: MemoryPaging<TEntity, TCursor>,
    store: MemoryStore<TEntity> = new MemoryStore<TEntity>(),
  ) {
    super(
      { [TRANSACTION_EXECUTOR]: store, store, isInTransaction: false },
      (context, work) =>
        context.store.transaction(async () => work({ ...context, isInTransaction: true })),
      paging,
    );

    this.compare = paging.compare ?? compareValues;
  }

  /** The store this repository reads and writes. */
  get store(): MemoryStore<TEntity> {
    return this.context.store;
  }

  override async findMany(filter: Readonly<TFilter & { limit?: number }>): Promise<TEntity[]> {
    const { limit } = filter;
    const matched = this.store.all.filter((entity) => this.matches(entity, filter));

    return limit != null ? matched.slice(0, limit) : matched;
  }

  override async insert(dto: Readonly<EntityInsert<TEntity>>): Promise<TEntity> {
    // The core contract promises an id when the caller does not supply one.
    const entity = { ...dto, id: dto.id ?? randomUUID() } as TEntity;

    return this.store.set(entity);
  }

  override async patchWhere(
    filter: Readonly<TFilter>,
    patch: EntityPatch<TEntity>,
  ): Promise<TEntity[]> {
    if (!hasClause(filter)) return [];

    const matched = await this.findMany(filter);

    return matched.map((entity) => this.store.set({ ...entity, ...patch }));
  }

  override async deleteWhere(filter: Readonly<TFilter>): Promise<TEntity[]> {
    if (!hasClause(filter)) return [];

    const matched = await this.findMany(filter);

    return matched.flatMap(({ id }) => this.store.delete(id) ?? []);
  }

  override idFilter(ids: readonly EntityId<TEntity>[]): TFilter {
    return { id: [...ids] } as TFilter;
  }

  /**
   * The rows of one page, in the order {@link compare} defines.
   *
   * Sorting happens per call, which is fine for the sizes a test holds; a repository
   * that pages far larger sets should keep its rows ordered on write.
   */
  protected override async fetchPage(
    filter: Readonly<TFilter> | undefined,
    cursor: TCursor | undefined,
    limit: number,
  ): Promise<TEntity[]> {
    const { compare } = this;
    const { read } = this.paging;

    const matched = this.store.all
      .filter((entity) => filter === undefined || this.matches(entity, filter))
      .filter((entity) => cursor === undefined || compare(read(entity), cursor) > 0)
      .sort((left, right) => compare(read(left), read(right)));

    return matched.slice(0, limit);
  }

  /**
   * Whether `entity` matches every defined key of `filter`.
   *
   * Protected so a custom filter can carry semantics the default property comparison cannot
   * express, the way a dialect repository overrides its own. A key the row does not have is
   * a mistake, the same way a filter on an unmapped column is for SQL, and throws instead of
   * silently matching nothing; that check needs a row to look at, so an empty store cannot
   * reject it.
   */
  protected matches(entity: TEntity, filter: Readonly<TFilter>): boolean {
    return Object.entries(filter).every(([property, expected]) => {
      // `limit` is the row count `findMany` applies, not a clause.
      if (property === "limit" || expected === undefined) return true;

      if (!Object.hasOwn(entity, property)) {
        throw new TypeError(`filter property "${property}" has no matching field`);
      }

      const actual = entity[property];

      // A row whose value is null behaves like a NULL column.
      if (expected === null) return actual == null;

      return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    });
  }
}

/** Whether `filter` carries at least one clause; an undefined value is not one. */
function hasClause(filter: Readonly<Record<string, unknown>>): boolean {
  return Object.values(filter).some((value) => value !== undefined);
}

/**
 * Orders two values the way SQL orders the columns they came from: strings
 * lexicographically, numbers numerically, dates chronologically.
 *
 * A cursor that carries more than one value has no natural order, so those repositories
 * pass their own {@link MemoryPaging.compare}.
 */
function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : 1;
  if (left instanceof Date && right instanceof Date) {
    if (left.getTime() === right.getTime()) return 0;

    return left.getTime() < right.getTime() ? -1 : 1;
  }

  throw new TypeError("composite cursors need a comparator");
}
