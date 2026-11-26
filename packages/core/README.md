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

## Status

Pre-1.0. The service and transaction primitives are under active development. While the API is
being built, the package exposes a placeholder export:

```ts
import { greet } from "@softzweig/spindle-core";

greet("world"); // "Hello, world!"
```
