# @softzweig/sample

Minimal sample package. It exists to show the shape of a library in this monorepo (build,
typecheck, tests, publish config) and is the starting point for a new package.

```ts
import { greet } from "@softzweig/sample";

greet("world"); // "Hello, world!"
```

Rename the package (and remove `"private": true`) when you turn it into a real library; see the
repository README.
