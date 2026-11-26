import type {
  Entity,
  EntityFilter,
  EntityId,
  EntityInsert,
} from "@softzweig/spindle-core/repository";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { AbstractDrizzleRepository, type DrizzleDatabase } from "../repository.js";

type SqliteIdentityFilter<TTable extends SQLiteTable> = EntityFilter<
  Entity & InferSelectModel<TTable>,
  SQL
>;

/**
 * SQLite binding for entities whose DTO is exactly their table row, so both
 * mappers are the identity. It differs from its Postgres counterpart only in the
 * table constraint.
 *
 * A repository can narrow or extend its filter through `TFilter`; it defaults to
 * {@link EntityFilter} with SQL extension values.
 */
export class SqliteRepository<
  TTable extends SQLiteTable,
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
    TTable extends SQLiteTable,
    TFilter extends SqliteIdentityFilter<TTable> = SqliteIdentityFilter<TTable>,
  >(db: DrizzleDatabase, table: TTable) {
    return new SqliteRepository<TTable, Entity & InferSelectModel<TTable>, TFilter>(db, table);
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
