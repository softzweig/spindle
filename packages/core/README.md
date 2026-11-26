# @softzweig/spindle-core

Composable primitives for building consistent, provider-independent backend systems.

Spindle provides services, transactions, and the wiring between them without binding your
application to a specific framework or database.

## Status

Pre-1.0. The service and transaction primitives are under active development. While the API is
being built, the package exposes a placeholder export:

```ts
import { greet } from "@softzweig/spindle-core";

greet("world"); // "Hello, world!"
```
