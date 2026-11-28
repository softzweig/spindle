# @softzweig/spindle-memory

## 0.2.0

### Minor Changes

- [#15](https://github.com/softzweig/spindle/pull/15) [`19e280b`](https://github.com/softzweig/spindle/commit/19e280b4b3fdca991935f12672ae088091708f96) Thanks [@vinznt](https://github.com/vinznt)! - Filter values compare by structure with `fast-deep-equal`, so a date, an array or a nested
  object a caller built separately matches the row holding its equal instead of requiring the
  same reference.

### Patch Changes

- Updated dependencies [[`204b8db`](https://github.com/softzweig/spindle/commit/204b8db40c8ef8b836c887d3091272bf0ebd4e10)]:
  - @softzweig/spindle-core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`13afa65`](https://github.com/softzweig/spindle/commit/13afa65ab62032528a469ad59b1755496f8ff2e9)]:
  - @softzweig/spindle-core@0.1.1

## 0.1.0

### Minor Changes

- [`108cf7e`](https://github.com/softzweig/spindle/commit/108cf7efcd075b24b2610708fb2b5c16bcfbdb4d) Thanks [@vinznt](https://github.com/vinznt)! - First release.
  
  - `@softzweig/spindle-core` carries services with a deferred `ServiceExecution` model, transactions
    with savepoints, lazy context members, keyset paginated repositories, and one `SpindleErrorCode`
    vocabulary behind both `ServiceError` and `RepositoryError`.
  - `@softzweig/spindle-drizzle` binds repositories to any drizzle driver for Postgres and SQLite,
    with `pagingById` and `pagingByCreatedAt` for the two common orders.
  - `@softzweig/spindle-memory` is an in-memory repository held to the same contract, for tests and
    early wiring.

- [`5151592`](https://github.com/softzweig/spindle/commit/51515926cb9beb430cf7b95c289c913e033cd223) Thanks [@vinznt](https://github.com/vinznt)! - Constraint failures arrive as a `RepositoryError` instead of a driver's own error.
  
  - `RepositoryError` gains the same factories as `ServiceError` (`of`, `notFound`, `invalidInput`,
    `forbidden`, `conflict`, `preconditionFailed`, `unavailable`, `unknown`), so an adapter reports
    the codes its backend can actually detect.
  - Both errors extend `SpindleError`, the base that carries `code`, `message` and `details`. They
    stay separate classes, but a transport mapping checks the base once instead of listing every
    layer, and `toServiceFailure` maps any `SpindleError` without being changed again.
  - `@softzweig/spindle-drizzle` translates constraint failures on insert, update and delete: a
    unique index or primary key becomes `conflict`, and a not-null, foreign key or check violation
    becomes `invalid_input`. The driver's own message and code are kept, and anything else is
    rethrown untouched with its original stack. The mapping is exported as `toRepositoryError` for
    statements written by hand.
  - `@softzweig/spindle-memory` rejects inserting an id that already exists with `conflict`, the
    answer a primary key gives, instead of silently replacing the row.
  - The shared repository contract covers the duplicate insert, so all three adapters are held to
    it.
  
  A service that lets one of these escape now reports `conflict` or `invalid_input` through
  `toServiceFailure`, instead of collapsing into `unknown`.

### Patch Changes

- Updated dependencies [[`108cf7e`](https://github.com/softzweig/spindle/commit/108cf7efcd075b24b2610708fb2b5c16bcfbdb4d), [`5151592`](https://github.com/softzweig/spindle/commit/51515926cb9beb430cf7b95c289c913e033cd223)]:
  - @softzweig/spindle-core@0.1.0
