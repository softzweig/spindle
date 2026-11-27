import { ServiceError } from "./service/service.error.js";

/**
 * Where a context records the executor it is bound to, for the adapter that bound it.
 *
 * The server never reads this: an adapter's transaction runner does, so a nested call nests on the
 * executor already in play instead of opening a second top-level transaction. A well-known symbol
 * keeps the slot out of the context's public shape, and lets every adapter name its own executor
 * type without the server knowing any of them.
 *
 * @reasoning
 * The reasoning for the need of this symbol is that this represents the current transaction
 * handle. Without this nested transactions would become multiple succeeding `BEGIN` statements in
 * SQL-based databases, instead of `SAVEPOINT` statements. Database adapters can use the executor to
 * determine on which returning instance the new transaction is ran on (e.g. the database instance,
 * or the transaction itself).
 *
 * @human
 */
export const TRANSACTION_EXECUTOR = Symbol.for("@softzweig/spindle-core/transaction-executor");

export type TransactionalContext = {
  /** False if the transaction is not active (no binding) */
  readonly isInTransaction: boolean;

  /** The executor the context is bound to, when the adapter that made it has one. */
  readonly [TRANSACTION_EXECUTOR]?: unknown;
};

/** Opens a transaction and runs `work` against the context it is bound to. */
export type TransactionRunner<TCtx extends TransactionalContext> = <T>(
  context: TCtx,
  work: (context: TCtx) => Promise<T>,
) => Promise<T>;

export interface Transactional<TCtx extends TransactionalContext> {
  /** Returns the current transaction context */
  getContext(): Readonly<TCtx>;

  /** Returns a copy of this object bound to the given transaction context */
  withContext(context: Readonly<TCtx>): this;

  /** Binds this object to a transaction context for the duration of the callback */
  transaction<T>(callback: (this: this, context: Readonly<TCtx>) => Promise<T>): Promise<T>;

  /** Throws if this object is not bound to a transaction context */
  assertTransaction(): void;

  /** Throws if this object is bound to a transaction context */
  assertNotTransaction(): void;
}

/**
 * Marks the instances a context rebinds when it is bound.
 *
 * Services follow the context that holds them, so a sibling called inside a
 * transaction joins it. Repositories do not: their context carries their own
 * state, and the transaction runner hands back handles that are already bound.
 */
export const FOLLOWS_CONTEXT = Symbol.for("@softzweig/spindle-core/follows-context");

/** Whether a context holding this member has to rebind it. */
function isFollowing(value: unknown): value is Transactional<TransactionalContext> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [FOLLOWS_CONTEXT]?: boolean })[FOLLOWS_CONTEXT] === true
  );
}

/** A copy of `instance` carrying `context`, leaving the context's members alone. */
function bindInstance<TInstance extends Transactional<TransactionalContext>>(
  instance: TInstance,
  context: TransactionalContext,
): TInstance {
  const bound = Object.create(instance);
  Object.defineProperty(bound, "context", { value: context, writable: false });
  return bound;
}

/**
 * Binds every service held by `context` to that same context, so a sibling called
 * inside a transaction joins it instead of keeping the binding it was constructed
 * with. A stale sibling would pass its own guards and run its work on the other
 * side of the transaction boundary, silently.
 *
 * One level deep on purpose: a bound member keeps the context it was handed, so a
 * service context has to accumulate the contexts of the services it holds, and
 * recurring would not terminate on a mutually dependent pair.
 */
const bindMembers = <TCtx extends TransactionalContext>(ctx: Readonly<TCtx>) =>
  Object.assign(
    // Start from the context itself, so symbol-keyed state survives the rebind. The executor an
    // adapter records lives in such a slot, and a nested transaction reads it back from here.
    { ...ctx },
    Object.fromEntries(
      Object.entries(ctx).map(([k, v]) => [k, isFollowing(v) ? bindInstance(v, ctx) : v]),
    ),
  ) as Readonly<TCtx>;

export class BaseTransactional<TCtx extends TransactionalContext> implements Transactional<TCtx> {
  constructor(
    protected readonly context: TCtx,
    private readonly createTransaction: TransactionRunner<TCtx>,
  ) {
    this.context = context;
  }

  getContext(): Readonly<TCtx> {
    return this.context;
  }

  /**
   * A copy of this service, of the same subclass, carrying another context.
   *
   * The services held by that context are bound to it as well; every other value
   * is carried over as it is. The copy itself comes from {@link clone}, so a
   * subclass holding `#private` state overrides that and not this.
   */
  withContext(context: Readonly<TCtx>): this {
    return this.clone(bindMembers(context));
  }

  /**
   * Produces a copy of this instance carrying an already bound context.
   *
   * The default shares the prototype and every own field of this instance, and adds
   * the context on top. Such a copy cannot read `#private` fields: private state lives
   * on the original instance, while the copy only sees the prototype it is made from.
   * A subclass that keeps private state must therefore override this method and build
   * the copy itself, usually by calling its own constructor.
   *
   * @see {@link withContext}
   */
  protected clone(context: Readonly<TCtx>): this {
    return bindInstance(this, context);
  }

  /**
   * Runs `fn` with a copy of this service bound to a transaction, so every
   * repository call inside it joins the same transaction.
   *
   * A nested call is a savepoint: the inner scope that throws undoes only its
   * own writes and leaves the outer transaction usable, while an outer failure
   * still discards everything the inner one committed.
   */
  transaction<T>(fn: (this: this, context: Readonly<TCtx>) => Promise<T>): Promise<T> {
    return this.createTransaction(this.context, (context) => {
      const service = this.withContext(context);
      return fn.call(service, service.getContext());
    });
  }

  /**
   * Asserts that this object is currently bound to a transaction.
   *
   * @see {@link assertNotTransaction}
   */
  assertTransaction(): void {
    ServiceError.assert(this.context.isInTransaction, "This service is not bound to a transaction");
  }

  /**
   * Asserts that this object is currently not bound to a transaction.
   *
   * @reasoning The reason for this assertion and its existence, is to be completely
   * certain that an expensive operation, such as calling an external service like
   * the underlying storage layer, is only performed outside an active transaction.
   * This is to ensure no unnecessary potential deadlocks occur during transactional
   * operations, causing transactional conflicts.
   *
   * @human
   */
  assertNotTransaction(): void {
    ServiceError.assert(!this.context.isInTransaction, "This service is bound to a transaction");
  }
}
