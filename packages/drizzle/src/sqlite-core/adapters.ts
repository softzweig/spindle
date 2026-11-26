import {
  createDrizzleAdapters,
  type DrizzleAdapters,
  type DrizzleRepositories,
} from "../adapters.js";
import type { DrizzleDatabase } from "../repository.js";

/**
 * Adapters for a SQLite database. The repository map carries whatever the
 * application wired; this only supplies the dialect-independent transaction
 * runner.
 */
export function createSqliteAdapters<TRepositories extends DrizzleRepositories>(
  db: DrizzleDatabase,
  repositories: TRepositories,
): DrizzleAdapters<TRepositories> {
  return createDrizzleAdapters(db, repositories);
}
