import type {
  Entity,
  EntityFilter,
  EntityId,
  EntityInsert,
} from "@softzweig/spindle-core/repository";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { AbstractDrizzleRepository, type DrizzleDatabase } from "../repository.js";

type PostgresIdentityFilter<TTable extends PgTable> = EntityFilter<
  Entity & InferSelectModel<TTable>,
  SQL
>;

/**
 * Postgres binding for entities whose DTO is exactly their table row, so both
 * mappers are the identity and the column map is derived from the table.
 *
 * One generic class replaces a subclass per entity: the table is the only thing
 * an entity has to supply, and `withContext` is inherited rather than overridden.
 * A repository can narrow or extend its filter through `TFilter`; it defaults to
 * {@link EntityFilter} with SQL extension values.
 */
export class PostgresRepository<
  TTable extends PgTable,
  TEntity extends Entity = Entity & InferSelectModel<TTable>,
  TFilter extends EntityFilter<TEntity, SQL> = EntityFilter<TEntity, SQL>,
> extends AbstractDrizzleRepository<TTable, TEntity, TFilter> {
  constructor(
    db: DrizzleDatabase,
    readonly table: TTable,
  ) {
    super(db);
  }

  static of<
    TTable extends PgTable,
    TFilter extends PostgresIdentityFilter<TTable> = PostgresIdentityFilter<TTable>,
  >(db: DrizzleDatabase, table: TTable) {
    return new PostgresRepository<TTable, Entity & InferSelectModel<TTable>, TFilter>(db, table);
  }

  protected toDto(row: InferSelectModel<TTable>): TEntity {
    return row as TEntity;
  }

  protected toRow(
    dto: Readonly<Partial<EntityInsert<TEntity>>>,
  ): Partial<InferInsertModel<TTable>> {
    // The entity is the row by construction, so no field mapping happens here.
    return dto as unknown as Partial<InferInsertModel<TTable>>;
  }

  override idFilter(ids: readonly EntityId<TEntity>[]): TFilter {
    return { id: [...ids] } as unknown as TFilter;
  }
}
