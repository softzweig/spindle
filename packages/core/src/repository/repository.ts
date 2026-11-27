import type { Transactional, TransactionalContext } from "../transactional.js";
import type { ListRequest, Page } from "./pagination.js";

/**
 * What a repository hands a transaction callback, and what a service can assert on.
 *
 * `isInTransaction` is `true` only inside {@link Repository.transaction},
 * so a service can require being part of one, or refuse to run in one, instead
 * of guessing from the call site.
 */
export type RepositoryContext = TransactionalContext;

export type Entity = Record<string, unknown> & {
  id: string | number; // Every entity/DTO must have a unique string or number identifier
};

export type EntityId<E extends Entity> = E["id"];

export type EntityInsert<E extends Entity> = Omit<E, "id"> & { id?: EntityId<E> };

export type EntityFilter<E extends Entity, TExtension = unknown> = {
  [K in keyof E]?: E[K] | E[K][] | TExtension;
};

export type EntityPatch<E extends Entity> = Readonly<Partial<Omit<E, "id">>>;

/**
 * Base interface for all repositories in Sprindle, providing standard CRUD operations.
 *
 * This is essentially our database abstraction layer, with a consistent interface that
 * generalizes database (or for that matter: backend) interactions into a uniform API.
 *
 * #### Design Decisions
 * This was one of the core decisions, making sure other than Suitcase/Stratforge, Sprindle
 * is fully storage- and database-agnostic. No forced Drizzle, SQL or any backend type.
 * You can literally plug in whatever database or backend you prefer.
 *
 * #### Building custom repositories
 * It's however of utmost importance to implement the core methods correctly.
 * The `@softzweig/sprindle-drizzle` package contains ready-made implementations for
 * Drizzle-based backends, where you get fully functional repositories that are scalable,
 * with indexes prebuilt into the schemas; have a look in case you want to implement
 * your own repositories or extend Sprindle's functionality.
 *
 * @human
 */
export interface Repository<
  TEntity extends Entity,
  TContext extends RepositoryContext = RepositoryContext,
  TFilter extends EntityFilter<TEntity> = EntityFilter<TEntity>,
  TCursor = EntityId<TEntity>,
> extends Transactional<TContext> {
  // Lookups

  /** Finds an entity by its unique identifier. Returns `null` if not found. */
  findById(id: EntityId<TEntity>): Promise<TEntity | null>;

  /** Finds entities by their unique identifiers. */
  findByIds(ids: readonly EntityId<TEntity>[]): Promise<TEntity[]>;

  /** Finds entities matching the given filter. */
  findMany(filter: Readonly<TFilter & { limit?: number }>): Promise<TEntity[]>;

  /** Lists one page of entities matching `filter`, in the repository's cursor order. */
  list(request: Readonly<ListRequest<TFilter, TCursor>>): Promise<Page<TEntity, TCursor>>;

  /** Finds a single entity matching the given filter. Returns `null` if not found. */
  findOne(filter: Readonly<TFilter>): Promise<TEntity | null>;

  /** Checks if any entity matching the given filter exists. */
  exists(filter: Readonly<TFilter>): Promise<boolean>;

  /** Counts the number of entities matching the given filter. */
  count(filter: Readonly<TFilter>): Promise<number>;

  // Mutations

  /** Inserts a new entity, generating the id when it is not supplied. */
  insert(dto: Readonly<EntityInsert<TEntity>>): Promise<TEntity>;

  /** Patches an entity by its unique identifier. */
  patch(id: EntityId<TEntity>, patch: EntityPatch<TEntity>): Promise<TEntity>;

  /** Patches entities matching the given filter. */
  patchWhere(filter: Readonly<TFilter>, patch: EntityPatch<TEntity>): Promise<TEntity[]>;

  /** Deletes entities by their unique identifiers. */
  delete(ids: readonly EntityId<TEntity>[]): Promise<TEntity[]>;

  /** Deletes entities matching the given filter. */
  deleteWhere(filter: Readonly<TFilter>): Promise<TEntity[]>;
}
