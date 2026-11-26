# @softzweig/spindle-drizzle

Drizzle-backed repositories for `@softzweig/spindle-core`. The base class
targets a small structural `DrizzleDatabase` port rather than a concrete
drizzle type, so any drizzle driver can back it. Postgres and SQLite
bindings are included.

Both `@softzweig/spindle-core` and `drizzle-orm` are peer dependencies, so install
them alongside this package. Core has to be a single copy because it owns the
`TRANSACTION_EXECUTOR` symbol and the error classes the repositories share; drizzle
has to be a single copy so the schema helpers and the repositories agree on column
and SQL types. The tested ranges are in `peerDependencies`.

## Usage

Extend `AbstractDrizzleRepository` and supply the table, the two mappers, and
how ids become a filter. The column map used to translate filters is derived
from the table.

```ts
import { AbstractDrizzleRepository } from "@softzweig/spindle-drizzle";
import type { EntityFilter, EntityId, EntityInsert } from "@softzweig/spindle-core/repository";
import { assets } from "./schema.js";

type Asset = typeof assets.$inferInsert;
type AssetFilter = EntityFilter<Asset>;

export class AssetRepository extends AbstractDrizzleRepository<typeof assets, Asset, AssetFilter> {
  protected readonly table = assets;

  protected toDto(row: typeof assets.$inferSelect): Asset {
    return { id: row.id, key: row.key, size: row.size };
  }

  protected toRow(dto: Readonly<Partial<EntityInsert<Asset>>>): Partial<Asset> {
    return { key: dto.key, size: dto.size };
  }

  idFilter(ids: readonly EntityId<Asset>[]): AssetFilter {
    return { id: [...ids] };
  }
}
```

The base class implements `findMany`, `insert`, `patchWhere`, `deleteWhere` and
`count` through drizzle. `findOne`, `findById`, `findByIds`, `patch`, `delete`,
`exists` and `transaction` come from `AbstractRepository`.

The table is the first generic and the entity defaults to its row type, so an
identity repository needs only name the table; a repository that maps rows to a
domain entity names both. Each repository can narrow or extend its filter through
the third generic, which defaults to `EntityFilter<TEntity, SQL>` so identity
repositories need no filter wiring. The dialect factories accept the same generic,
for example `PostgresRepository.of<typeof assets, SizeFilter>(db, assets)`. Override
`idFilter` when the filter carries required fields beyond `id`.

For identity-mapped tables (i.e. entity <=> table), use the dialect helpers:

```ts
import { PostgresRepository } from "@softzweig/spindle-drizzle/pg-core";
import { SqliteRepository } from "@softzweig/spindle-drizzle/sqlite-core";

const assets = PostgresRepository.of(db, assetsTable);
```

## Transactions

`transaction` runs the callback against a copy of the repository bound to the
transaction handle, and hands it a `DrizzleContext` so services can tell
whether they are inside one:

```ts
await assets.transaction(async (context) => {
  await otherRepository.withContext(context).patch(id, patch);
});
```

`context.isInTransaction` is `true` and `context.db` is the transaction handle.
`withContext` is how a second repository joins the same transaction.

`createDrizzleAdapters(db, repositories)` wires a repository map and a generic
transaction runner. Each repository in the map is rebound to the transaction
context, and a nested call nests on the handle already in play.

## Filters

Filter keys are entity property names and are resolved through the table
columns. A scalar becomes `=`, an array becomes `in (...)`, `null` becomes
`is null`, and an unknown property throws a `TypeError` instead of silently
widening the query.
