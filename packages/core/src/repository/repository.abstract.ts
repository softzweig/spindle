import { BaseTransactional, type TransactionRunner } from "../transactional.js";
import { type ListRequest, type Page, type Paging, toPage } from "./pagination.js";
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
 * Base for every repository: implements the id lookups and the paging arithmetic once, so
 * an adapter only has to describe how to query rows and how a row becomes its cursor.
 *
 * `findMany`, `insert`, `patchWhere`, `deleteWhere` and `fetchPage` stay abstract, they are
 * the parts that genuinely differ per backend; the transaction plumbing comes from
 * {@link BaseTransactional}.
 */
export abstract class AbstractRepository<
    TEntity extends Entity,
    TContext extends RepositoryContext = RepositoryContext,
    TFilter extends EntityFilter<TEntity> = EntityFilter<TEntity>,
    TCursor = EntityId<TEntity>,
  >
  extends BaseTransactional<TContext>
  implements Repository<TEntity, TContext, TFilter, TCursor>
{
  /** How this repository pages, as handed to the constructor. */
  protected readonly paging: Paging<TEntity, TCursor>;

  /**
   * @param context The context this repository is bound to.
   * @param createTransaction The runner transactions are opened with.
   * @param paging How a row becomes the cursor that resumes after it. Paging by an id is
   *   `{ read: (entity) => entity.id }`; a cursor that carries more is read the same way.
   */
  constructor(
    context: TContext,
    createTransaction: TransactionRunner<TContext>,
    paging: Paging<TEntity, TCursor>,
  ) {
    super(context, createTransaction);
    this.paging = paging;
  }

  abstract findMany(filter: Readonly<TFilter & { limit?: number }>): Promise<TEntity[]>;

  abstract insert(dto: Readonly<EntityInsert<TEntity>>): Promise<TEntity>;

  abstract patchWhere(filter: Readonly<TFilter>, patch: EntityPatch<TEntity>): Promise<TEntity[]>;

  abstract deleteWhere(filter: Readonly<TFilter>): Promise<TEntity[]>;

  abstract idFilter(ids: readonly EntityId<TEntity>[]): TFilter;

  /**
   * One page of rows, in the order the repository pages in.
   *
   * The rows come back unsliced and in cursor order; {@link toPage} slices them into the
   * page its caller asked for.
   */
  protected abstract fetchPage(
    filter: Readonly<TFilter> | undefined,
    cursor: TCursor | undefined,
    limit: number,
  ): Promise<TEntity[]>;

  /**
   * One page of entities, and the cursor that continues it.
   *
   * @see {@link Repository.list}
   */
  async list(request: Readonly<ListRequest<TFilter, TCursor>>): Promise<Page<TEntity, TCursor>> {
    const { limit, cursor, filter } = request;

    // A page of nothing is a caller mistake, and slicing by a fraction or a NaN hides it.
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`page limit must be a positive integer, got ${limit}`);
    }

    // The one row past the page is what tells a full page from the last one.
    const rows = await this.fetchPage(filter, cursor, limit + 1);

    return toPage(rows, limit, this.paging.read);
  }

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
