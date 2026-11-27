---
"@softzweig/spindle-core": minor
"@softzweig/spindle-drizzle": minor
"@softzweig/spindle-memory": minor
---

First release.

- `@softzweig/spindle-core` carries services with a deferred `ServiceExecution` model, transactions
  with savepoints, lazy context members, keyset paginated repositories, and one `ServiceErrorCode`
  vocabulary behind both `ServiceError` and `RepositoryError`.
- `@softzweig/spindle-drizzle` binds repositories to any drizzle driver for Postgres and SQLite,
  with `pagingById` and `pagingByCreatedAt` for the two common orders.
- `@softzweig/spindle-memory` is an in-memory repository held to the same contract, for tests and
  early wiring.

