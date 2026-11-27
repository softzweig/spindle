---
"@softzweig/spindle-core": minor
"@softzweig/spindle-drizzle": minor
"@softzweig/spindle-memory": minor
---

Constraint failures arrive as a `RepositoryError` instead of a driver's own error.

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
