import { BaseTransactional } from "../transactional.js";
import type {
  Entity,
  EntityFilter,
  EntityId,
  EntityInsert,
  EntityPatch,
  Repository,
  RepositoryContext,
} from "./repository.js";

/**
 * Base for every repository: implements the id lookups once, in terms of
 * {@link findMany}, so an adapter only has to describe how to query a set of rows.
 *
 * `findMany`, `insert`, `patchWhere` and `deleteWhere` stay abstract, they are the
 * parts that genuinely differ per backend; the transaction plumbing comes from
 * {@link BaseTransactional}.
 */
export abstract class AbstractRepository<
    TEntity extends Entity,
    TContext extends RepositoryContext = RepositoryContext,
    TFilter extends EntityFilter<TEntity> = EntityFilter<TEntity>,
  >
  extends BaseTransactional<TContext>
  implements Repository<TEntity, TContext, TFilter>
{
  abstract findMany(filter: Readonly<TFilter & { limit?: number }>): Promise<TEntity[]>;

  abstract insert(dto: Readonly<EntityInsert<TEntity>>): Promise<TEntity>;

  abstract patchWhere(filter: Readonly<TFilter>, patch: EntityPatch<TEntity>): Promise<TEntity[]>;

  abstract deleteWhere(filter: Readonly<TFilter>): Promise<TEntity[]>;

  abstract idFilter(ids: readonly EntityId<TEntity>[]): TFilter;

  async patch(id: EntityId<TEntity>, patch: EntityPatch<TEntity>): Promise<TEntity> {
    const [updated] = await this.patchWhere(this.idFilter([id]), patch);
    if (!updated) throw new Error(`Entity with id ${id} not found`);
    return updated;
  }

  /** Deletes the rows matching `ids`, through {@link deleteWhere}. */
  async delete(ids: readonly EntityId<TEntity>[]): Promise<TEntity[]> {
    if (ids.length === 0) return [];
    return this.deleteWhere(this.idFilter(ids));
  }

  /** First match of `filter`; `null` when nothing matches. */
  async findOne(filter: Readonly<TFilter>): Promise<TEntity | null> {
    const [found] = await this.findMany(filter);
    return found ?? null;
  }

  /** Whether any row matches `filter`, through {@link findOne}. */
  async exists(filter: Readonly<TFilter>): Promise<boolean> {
    return (await this.findOne(filter)) != null;
  }

  /**
   * Counts the rows matching `filter`.
   *
   * The default loads them through {@link findMany}; adapters should override it
   * with a count query when the backend can do better.
   */
  async count(filter: Readonly<TFilter>): Promise<number> {
    return (await this.findMany(filter)).length;
  }

  /** Reads a single row by id; `null` when it does not exist. */
  async findById(id: EntityId<TEntity>): Promise<TEntity | null> {
    return this.findOne(this.idFilter([id]));
  }

  /** Reads the rows matching `ids`; unknown ids are simply absent from the result. */
  async findByIds(ids: readonly EntityId<TEntity>[]): Promise<TEntity[]> {
    if (ids.length === 0) return [];
    return this.findMany(this.idFilter(ids));
  }
}
