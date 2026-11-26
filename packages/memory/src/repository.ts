import { randomUUID } from "node:crypto";
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
import { MemoryStore } from "./store.js";

/** The context a memory repository passes to a transaction callback. */
export interface MemoryContext<TEntity extends Entity = Entity> extends RepositoryContext {
  /** The store this context is bound to. */
  readonly store: MemoryStore<TEntity>;

  /** The same store, in the slot a transaction runner reads back. */
  readonly [TRANSACTION_EXECUTOR]: MemoryStore<TEntity>;
}

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
> extends AbstractRepository<TEntity, MemoryContext<TEntity>, TFilter> {
  constructor(store: MemoryStore<TEntity> = new MemoryStore<TEntity>()) {
    super({ [TRANSACTION_EXECUTOR]: store, store, isInTransaction: false }, (context, work) =>
      context.store.transaction(async () => work({ ...context, isInTransaction: true })),
    );
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
   * Whether `entity` matches every defined key of `filter`.
   *
   * Protected so a custom filter can carry semantics the default property
   * comparison cannot express, the way a dialect repository overrides its own.
   */
  protected matches(entity: TEntity, filter: Readonly<TFilter>): boolean {
    return Object.entries(filter).every(([property, expected]) => {
      // `limit` is the row count `findMany` applies, not a clause.
      if (property === "limit" || expected === undefined) return true;

      const actual = entity[property];

      // A row without the property behaves like a NULL column.
      if (expected === null) return actual == null;

      return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    });
  }
}

/** Whether `filter` carries at least one clause; an undefined value is not one. */
function hasClause(filter: Readonly<Record<string, unknown>>): boolean {
  return Object.values(filter).some((value) => value !== undefined);
}
