# Spindle

Composable primitives for building consistent, provider-independent backend systems.

Spindle provides the seams a backend needs, services, transactions, and the wiring between them,
without coupling your application to a framework or a database. Think of it as a deliberately small
take on what NestJS offers: composable primitives instead of a global container and a fixed
application structure.

One pnpm workspace, one Turborepo build graph, one Biome config, one Vitest run, Lefthook for git
hooks, Changesets for versioning, and a CI workflow that verifies every change and publishes from
`main`.

## Packages

| Package                        | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `@softzweig/spindle-core`      | Services, transactions, and the primitives the other packages build on |
| `@softzweig/spindle-drizzle`   | Drizzle ORM repository bindings for Postgres and SQLite                |
| `@softzweig/spindle-memory`    | Ephemeral in-memory repositories, for tests and early wiring           |
| `@softzweig/typescript-config` | Shared tsconfig presets (private, never published)                     |

## Requirements

- Node.js 22 or newer
- pnpm via Corepack: `corepack enable`

## Structure

```
.
├── .changeset/            release notes and Changesets config
├── .github/workflows/     CI: verify on every change, release from main
├── packages/
│   ├── core/              @softzweig/spindle-core
│   ├── drizzle/           @softzweig/spindle-drizzle
│   ├── memory/            @softzweig/spindle-memory
│   └── typescript-config/ shared tsconfig presets (private, never published)
├── .lefthook.yml          pre-commit and pre-push hooks
├── biome.json             lint and format for the whole repo
├── turbo.json             build and typecheck task graph
└── vitest.config.ts       one global test run
```

## Commands

| Command                 |                                                    |
| ----------------------- | -------------------------------------------------- |
| `pnpm install`          | Install all workspace dependencies                 |
| `pnpm build`            | Build every package (Turborepo, cached)            |
| `pnpm dev`              | Watch-build every package                          |
| `pnpm test`             | Run every test in one Vitest run                   |
| `pnpm test:unit`        | Unit project only (`*.test.ts`, `*.unit.test.ts`)  |
| `pnpm test:integration` | Integration project only (`*.integration.test.ts`) |
| `pnpm test:watch`       | Vitest watch mode (all projects)                   |
| `pnpm typecheck`        | Typecheck every package                            |
| `pnpm lint`             | Biome check across the repo                        |
| `pnpm check`            | Biome check + safe fixes                           |
| `pnpm format`           | Biome format + write                               |
| `pnpm changeset`        | Record a release note (bump type) for a PR         |
| `pnpm version:packages` | Apply pending changesets (bump + changelogs)       |
| `pnpm publish:packages` | Build, then publish unpublished versions           |

Git hooks mirror the gate: `pre-commit` runs Biome on the staged files and `pnpm typecheck`,
`pre-push` runs `pnpm test`.

## Shared TypeScript configs

Each package extends one of the presets from `@softzweig/typescript-config` (a `workspace:*` dev
dependency, never published):

| Preset               | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `base.json`          | Typecheck-only (no emit) strict baseline         |
| `library.json`       | Node ESM library emitting `dist/` + declarations |
| `react-library.json` | Same as `library.json` with React JSX + DOM libs |

```jsonc
// packages/<name>/tsconfig.build.json
{
  "extends": "@softzweig/typescript-config/library.json",
  "include": ["src"],
  "compilerOptions": { "rootDir": "src", "outDir": "dist" }
}
```

Rule of thumb: `tsconfig.json` extends `base.json` and includes tests (typecheck), while
`tsconfig.build.json` extends the library preset and includes only `src` (emit).

## Testing

Vitest is installed and configured globally, like Biome — one root config, one command, split by
file name:

```ts
// vitest.config.ts
projects: [
  { test: { name: "unit", include: ["packages/*/{src,test}/**/*.test.ts"] } },
  { test: { name: "integration", include: ["packages/*/{src,test}/**/*.integration.test.ts"] } },
];
```

- `*.integration.test.ts` runs in the `integration` project, for slow tests that need external
  services.
- Every other `*.test.ts` is a unit test, with or without the `.unit` qualifier: `service.test.ts`
  and `service.unit.test.ts` are both unit tests.

`pnpm test` runs both projects. `pnpm test:unit` and `pnpm test:integration` run one of them, and
`--project <name>` works on any Vitest command. Tests live in `packages/<name>/test/**` (or next to
the source) and import the public API from source (`../src/index.js`), so no build step is required.

The repository contract that both adapters run lives in `packages/core/test/contract`. It is test
code, not part of a published package, and the adapter tests import it by relative path.

## Adding a package

1. Create `packages/<name>` with its own `package.json`, `tsconfig.json`, and `tsconfig.build.json`.
2. Name it `@softzweig/spindle-<name>` and set `repository.directory` to `packages/<name>`.
3. Keep `publishConfig` pointed at GitHub Packages.
4. `pnpm install`.

## Versioning

Versions are managed by [Changesets](https://changesets.dev/) — never edit a `version` by hand.

1. In your PR, run `pnpm changeset`, pick the packages and the bump type (`patch` / `minor` /
   `major`), and commit the generated `.changeset/*.md` file.
2. On every push to `main`, CI keeps a Version Packages PR up to date (`changeset version`): it
   bumps versions, writes `CHANGELOG.md`, and refreshes the lockfile.
3. Merge that PR to release. With no changesets left, CI publishes the bumped versions to GitHub
   Packages, creates the `@softzweig/<pkg>@<version>` tags and a GitHub release per package.

Changelogs use `@changesets/changelog-github`, so entries link the merged PR and credit its author.
It resolves the repo from `GITHUB_REPOSITORY` and calls the GitHub API with `GITHUB_TOKEN` — both
set automatically in Actions. For a local `pnpm version:packages`, provide them yourself:

```bash
GITHUB_REPOSITORY=<owner>/<repo> GITHUB_TOKEN=<token> pnpm version:packages
```

The release job needs Settings → Actions → General → "Allow GitHub Actions to create and approve
pull requests" enabled so it can open the Version Packages PR.

## Publishing

Packages are configured to publish to GitHub Packages as public packages, so the npm scope
(`@softzweig`) must match the GitHub owner that owns this repository.

- `publishConfig` in each package sets `registry` and `access: public`.
- `.npmrc` routes `@softzweig/*` to `https://npm.pkg.github.com`.
- GitHub Packages defaults new packages to private. After the first public publish, confirm each
  package page is set to Public; changing visibility is irreversible.

npm installs still require authentication, even for public GitHub Packages. Consumers need a token
with `read:packages` in their `~/.npmrc`:

```
@softzweig:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, changesets, and the pull request workflow.
Security issues must be reported privately as described in [SECURITY.md](SECURITY.md).

## License

MIT, Copyright (c) 2026 Vinzent Zeband. See [LICENSE](LICENSE).
