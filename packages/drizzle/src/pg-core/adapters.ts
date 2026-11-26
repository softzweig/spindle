import type { DrizzleAdapters, DrizzleRepositories } from "../adapters.js";
import { createDrizzleAdapters } from "../adapters.js";
import type { DrizzleDatabase } from "../repository.js";

/**
 * Adapters for a Postgres database. The repository map carries whatever the
 * application wired; this only supplies the dialect-independent transaction
 * runner.
 */
export function createPostgresAdapters<TRepositories extends DrizzleRepositories>(
  db: DrizzleDatabase,
  repositories: TRepositories,
): DrizzleAdapters<TRepositories> {
  return createDrizzleAdapters(db, repositories);
}
