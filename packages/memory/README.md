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
gets a generated one, as the core contract promises.

## Filters

Filter keys are entity properties: a scalar matches equality, an array matches
membership, `null` matches a null or absent value, and an undefined value is
ignored. An empty array matches nothing.

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
