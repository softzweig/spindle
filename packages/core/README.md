# @softzweig/spindle-core

Composable primitives for building consistent, provider-independent backend systems.

Spindle provides services, transactions, and the wiring between them without binding your
application to a specific framework or database.

## Lazy dependencies

Two services that call each other cannot both be created before the other exists. Hand one of
them over through `lazy`, and the member resolves the first time it is read:

```ts
import { lazy } from "@softzweig/spindle-core/service";

const assets: AssetService = new AssetService(
  { ...assetContext, resources: lazy(() => resources) },
  runTransactions,
);

const resources: ResourceService = new ResourceService(
  { ...resourceContext, assets: lazy(() => assets) },
  runTransactions,
);
```

A service never sees the placeholder: `this.context.resources.someMethod()` is the same call
whether the dependency was wrapped or not, and a lazy dependency still has to implement
`ServiceExecutionContract` like any other.

Two things to keep in mind:

- **Annotate both constants** (or declare them as typed fields). Each context names the other
  service, so an initialiser cannot be the source of its own type.
- The member is resolved on **every access**, not once. Give the resolver a stable instance if
  that matters, and note that a transaction rebinds the context by value, which pins the
  dependency for the length of that scope.

## Pagination

Every repository can list one page at a time. The cursor is whatever orders a row in that
repository, the id by default, and it is opaque to the caller, which only hands it back:

```ts
const page = await assets.list({ limit: 20, filter: { size: 20 } });

if (page.nextCursor !== null) {
  const next = await assets.list({ limit: 20, cursor: page.nextCursor });
}
```

`AbstractRepository` owns the arithmetic: it asks `fetchPage` for one row more than the page
holds, which is what tells a full page from the last one without a count, and turns the last
row into a cursor through the `Paging` definition the repository is built with. An adapter
describes how rows are ordered and how a row becomes a cursor; `@softzweig/spindle-drizzle`
and `@softzweig/spindle-memory` both ship ready-made definitions, including composite ones
such as a timestamp paired with an id.

## Errors

A repository throws what a caller can branch on. A malformed call is a programmer mistake and
stays a JavaScript error: a `RangeError` for a page limit that is not a positive integer, a
`TypeError` for a filter or cursor a backend cannot express. A well formed call that cannot
succeed throws `RepositoryError`, which carries a `SpindleErrorCode`:

```ts
import { RepositoryError } from "@softzweig/spindle-core/repository";

try {
  await assets.patch(id, { note: "reviewed" });
} catch (error) {
  if (error instanceof RepositoryError) {
    // error.code maps like a service failure
  }
}
```

`toServiceFailure` maps it already, so a repository error escaping a prepared execution keeps
its code and message instead of collapsing into `unknown`.

`ServiceError` and `RepositoryError` are both `SpindleError`, a base that carries nothing but
`code`, `message` and `details`. A transport mapping checks the base once, so the next layer
that adds an error maps itself without touching core, while a call site that needs to know
which layer failed narrows to the subclass.

`AbstractRepository` reports `not_found` for a patch that matched nothing. What a backend can
detect on its own, an adapter reports too: a duplicate id is `conflict`, and a violated column
rule is `invalid_input`. Everything else stays the driver's error, unflattened.

## Imports

The package has no root entry point: every import names the module it comes from
(`@softzweig/spindle-core/service`, `/repository`, `/result`, `/transactional`). A service, a
repository and a result therefore never pull each other in just because one of them is used.

## Status

Pre-1.0. The service, transaction and repository primitives are under active development,
so minor releases may still rename or reshape them.
