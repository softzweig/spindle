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

Extend `AbstractDrizzleRepository` and supply the table, the two mappers, how ids
become a filter, and how the repository pages. The column map used to translate
filters is derived from the table.

```ts
import {
  AbstractDrizzleRepository,
  type DrizzleDatabase,
  pagingById,
} from "@softzweig/spindle-drizzle";
import type { EntityFilter, EntityId, EntityInsert } from "@softzweig/spindle-core/repository";
import { assets } from "./schema.js";

type Asset = typeof assets.$inferInsert;
type AssetFilter = EntityFilter<Asset>;

export class AssetRepository extends AbstractDrizzleRepository<typeof assets, Asset, AssetFilter> {
  constructor(db: DrizzleDatabase) {
    // Pages by the row id; pass your own DrizzlePaging for anything else.
    super(db, assets, pagingById(assets));
  }

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

## Pagination

`list` returns one page and the cursor that continues it. A repository declares how its
pages are ordered and read by passing a `DrizzlePaging` to `super`; `pagingById` covers the
common case of paging by the row id, and `pagingByCreatedAt` the one of paging newest first:

```ts
import {
  AbstractDrizzleRepository,
  type CreatedAtCursor,
  type DrizzleDatabase,
  pagingByCreatedAt,
} from "@softzweig/spindle-drizzle";

class NewestAssets extends AbstractDrizzleRepository<
  typeof assets,
  Asset,
  AssetFilter,
  CreatedAtCursor<Asset>
> {
  constructor(db: DrizzleDatabase) {
    // Orders by createdAt, newest first, with the id breaking ties.
    super(db, assets, pagingByCreatedAt(assets));
  }
}
```

A paging spec is just `keys` and `read`, so anything else is declared the same way:

```ts
super(db, assets, {
  keys: [
    { column: assets.size, direction: "desc", of: (cursor) => cursor.size },
    { column: assets.id, direction: "desc", of: (cursor) => cursor.id },
  ],
  read: (asset) => ({ size: asset.size, id: asset.id }),
});
```

`keys` is the order, narrowest first, and `read` builds the cursor a row hands to the next
page. The `order by` and the keyset `where` are derived from them, so a page resumes after
its last row instead of skipping or repeating rows that share a leading key. The cursor type
is the fourth generic and defaults to `EntityId<TEntity>`.

```ts
const page = await assets.list({ limit: 20, filter: { size: 20 } });
const next = await assets.list({ limit: 20, cursor: page.nextCursor ?? undefined });
```

`nextCursor` is `null` on the last page. The repository asks the database for one row more
than the page holds, which is what tells a full page from the last one without a count.

This package runs the same repository contract as `@softzweig/spindle-memory`
(`packages/core/test/contract`) against PGlite and libSQL, so the adapters stay
interchangeable: the same call returns the same result, transactions included.

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
