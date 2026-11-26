import {
  TRANSACTION_EXECUTOR,
  type Transactional,
  type TransactionalContext,
} from "@softzweig/spindle-core/transactional";
import type { DrizzleContext, DrizzleDatabase } from "./repository.js";

/**
 * A repository map an adapter can rebind as a unit.
 *
 * Repositories do not follow a context, so the transaction runner rebinds each
 * one explicitly instead of relying on the context holder to do it.
 *
 * @human
 */
export type DrizzleRepositories = Readonly<Record<string, Transactional<DrizzleContext>>>;

/**
 * Runs work on one drizzle transaction handle.
 *
 * The work context is the caller's context extended with the transaction handle
 * and every repository rebound to it, so a sibling call joins the same
 * transaction.
 *
 * @human
 */
export type DrizzleTransactionRunner<
  TRepositories extends DrizzleRepositories = DrizzleRepositories,
> = <TContext extends TransactionalContext, TResult>(
  context: TContext,
  work: (context: TContext & DrizzleContext & TRepositories) => Promise<TResult>,
) => Promise<TResult>;

/** What a drizzle adapter shares with the rest of the system. */
export interface DrizzleAdapters<TRepositories extends DrizzleRepositories = DrizzleRepositories> {
  readonly repositories: TRepositories;
  readonly transaction: DrizzleTransactionRunner<TRepositories>;
}

/**
 * The handle the context is already bound to, when it is inside a transaction.
 *
 * A nested call has to nest on this handle instead of the root: asking the root
 * for a second transaction leaves it waiting for the outer one to finish, and on
 * a single-connection driver the two never settle. Nesting on the handle is a
 * savepoint, which is what the services promise.
 */
function boundHandle(context: TransactionalContext): DrizzleDatabase | undefined {
  const handle = context[TRANSACTION_EXECUTOR];
  return isDrizzleHandle(handle) ? handle : undefined;
}

function isDrizzleHandle(value: unknown): value is DrizzleDatabase {
  return (
    typeof value === "object" &&
    value !== null &&
    "transaction" in value &&
    typeof value.transaction === "function"
  );
}

function createTransactionRunner<TRepositories extends DrizzleRepositories>(
  db: DrizzleDatabase,
  repositories: TRepositories,
): DrizzleTransactionRunner<TRepositories> {
  return (context, work) => {
    const handle = (context.isInTransaction ? boundHandle(context) : undefined) ?? db;

    return handle.transaction((transaction) => {
      const executor = Object.freeze<DrizzleContext>({
        [TRANSACTION_EXECUTOR]: transaction,
        db: transaction,
        isInTransaction: true,
      });
      const rebound = Object.fromEntries(
        Object.entries(repositories).map(([key, repository]) => [
          key,
          repository.withContext(executor),
        ]),
      );

      // The core cannot express "this context, with these members rebound"
      // generically, so the adapter asserts the shape it just built. The members
      // it replaces are the ones it owns.
      const bound = Object.freeze({
        ...context,
        ...executor,
        ...rebound,
      }) as typeof context & DrizzleContext & TRepositories;

      return work(bound);
    });
  };
}

/**
 * Wires a repository map and the transaction runner that binds it to a single
 * handle. A dialect adapter only has to name its repositories.
 */
export function createDrizzleAdapters<TRepositories extends DrizzleRepositories>(
  db: DrizzleDatabase,
  repositories: TRepositories,
): DrizzleAdapters<TRepositories> {
  return { repositories, transaction: createTransactionRunner(db, repositories) };
}
