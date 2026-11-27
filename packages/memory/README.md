# @softzweig/spindle-memory

In-memory repositories for `@softzweig/spindle-core`. The rows live in process
memory, so they are gone when the process is: this is meant for tests, and for
wiring a service before a real store exists, not for keeping data.

`@softzweig/spindle-core` is a peer dependency, install it alongside this package
so the `TRANSACTION_EXECUTOR` symbol and the core classes stay single-instance.

## Usage

```ts
import { MemoryRepository } from "@softzweig/spindle-memory";
import type { EntityFilter } from "@softzweig/spindle-core/repository";

type Asset = { readonly id: string; readonly key: string; readonly size: number };
type AssetFilter = EntityFilter<Asset>;

const assets = new MemoryRepository<Asset, AssetFilter>();

const asset = await assets.insert({ key: "assets/a.png", size: 42 });

await assets.findMany({ size: 42 }); // [asset]
await assets.findById(asset.id); // asset
```

`MemoryRepository` is concrete, there is no subclass to write: the entity is the
row, and the id filter is the standard `id` property. An insert without an `id`
gets a generated one, as the core contract promises, and an insert that reuses an
id throws a `RepositoryError` with `conflict`, the same answer a primary key gives.

## Filters

Filter keys are entity properties: a scalar matches equality, an array matches
membership, `null` matches a null or absent value, and an undefined value is
ignored. An empty array matches nothing, and a key the rows do not have throws,
the same way an unmapped column does for SQL.

This package runs the same repository contract as `@softzweig/spindle-drizzle`
(`packages/core/test/contract`), so the two are interchangeable: the same call
returns the same result, transactions included.

Writes with no clause in their filter (`{}`, or only undefined values) match
nothing, the same guard the SQL adapters apply, so a forgotten filter cannot take
the whole store with it. `findMany({})` still returns everything.

A repository can narrow or extend its filter through the second generic. The
property comparison is `protected matches`, override it when a custom filter
needs semantics equality cannot express:

```ts
import type { EntityFilter } from "@softzweig/spindle-core/repository";

type RecentFilter = EntityFilter<Asset> & { readonly minimumSize: number };

class LargeAssets extends MemoryRepository<Asset, RecentFilter> {
  protected override matches(asset: Asset, filter: RecentFilter): boolean {
    return super.matches(asset, filter) && asset.size >= filter.minimumSize;
  }
}

declare const largeAssets: LargeAssets;
await largeAssets.findMany({ minimumSize: 100 });
```

## Pagination

`list` returns one page and the cursor that continues it. A repository says how its rows
become cursors, and in which order, through the first constructor argument:

```ts
import { MemoryRepository } from "@softzweig/spindle-memory";

// Pages by id.
const assets = MemoryRepository.byId<Asset, AssetFilter>();

// Pages newest first, the id breaking ties.
const latest = MemoryRepository.byCreatedAt<Asset, AssetFilter>();

// Anything else is a cursor of your own.
const newest = new MemoryRepository<Asset, AssetFilter, number>({
  read: (asset) => asset.size,
  compare: (left, right) => right - left,
});
```

`read` takes the cursor of a row and `compare` orders two cursors; without one, cursors
are ordered as the values SQL compares, strings lexicographically and numbers numerically.
A cursor that carries more than one value needs a `compare` of its own. The page filter and
the sort are both built on the two, so a page resumes after its last row instead of
skipping or repeating one, and `list` asks for one row more than the page holds, which is
what tells a full page from the last one.

```ts
const page = await assets.list({ limit: 10 });
const next = await assets.list({ limit: 10, cursor: page.nextCursor ?? undefined });
```

## Transactions

`transaction` snapshots the store the repository is bound to, so a callback that
throws leaves the rows as they were. A nested transaction snapshots again, which
makes it a savepoint: the inner scope that fails undoes only its own writes.

Repositories built on the same `MemoryStore` share their rows, and a rollback
covers all of them:

```ts
import { MemoryRepository, MemoryStore } from "@softzweig/spindle-memory";

const store = new MemoryStore<Asset>();
const writer = new MemoryRepository<Asset, AssetFilter>(store);
const reader = new MemoryRepository<Asset, AssetFilter>(store);
```

Separate stores are independent, so each repository is a clean slate for the next
test unless a store is shared on purpose. Transactions do not span repositories of
different entity types; there is no adapter for that yet.
