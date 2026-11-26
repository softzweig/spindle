import { ServiceErrorCode, type ServiceFailure } from "../result.js";
import { BaseTransactional, FOLLOWS_CONTEXT, type TransactionalContext } from "../transactional.js";
import { ServiceError } from "./service.error.js";
import { ServiceExecution } from "./service.execution.js";

/**
 * A function the consumer keeps in the context, such as a resolve limit or a download
 * expiry policy. Like plain data it is carried into a transaction untouched.
 */
export type ServiceContextFunction = (...args: never[]) => unknown;

type ServiceContextBase = TransactionalContext & {
  /** Converts an unknown error into a structured service failure. @default toServiceFailure */
  readonly toServiceFailure?: (error: unknown) => ServiceFailure;
};

export type ServiceContext<T extends Record<string, unknown> = Record<string, unknown>> = T &
  ServiceContextBase;

export type InferServiceContext<T> = T extends Service<infer C> ? C : never;

/**
 * Requires every public method a concrete service declares to return a
 * {@link ServiceExecution}.
 *
 * @note
 * We need this only when we want to enforce that all public methods of a service return
 * a {@link ServiceExecution}. This is helpful for ensuring consistent boundaries and *should*
 * be enforced within each service, but is not necessarily required. This just generally
 * helps to have a consistent opinion about Spindle's service execution model.
 *
 * @example
 * ```ts
 * class MyService extends Service<ServiceContext> {
 *
 *   // Error: must return ServiceExecution, not a Promise
 *   async subtract(a: number, b: number): Promise<number> { ... }
 *
 *   // Correct: private or protected methods are not checked for ServiceExecution
 *   private async divide(a: number, b: number): Promise<number> { ... }
 *
 *   // Correct: public methods must return ServiceExecution (no explicit return type necessary)
 *   sum(a: number, b: number): ServiceExecution<number> { ... }
 *
 * }
 * ```
 *
 * @human
 */
export type ServiceExecutionContract<TService> = {
  [K in keyof TService as K extends keyof Service<ServiceContext>
    ? never
    : TService[K] extends (...args: never[]) => unknown
      ? K
      : never]: TService[K] extends ServiceExecutionMethod
    ? TService[K]
    : { [P in `Service method "${K & string}" must return ServiceExecution`]: never };
};

/** A public service method folds its outcome into a {@link ServiceExecution}. */
export type ServiceExecutionMethod = (...args: never[]) => ServiceExecution<unknown>;

/**
 * Base for services: carries the context and hands subclasses a transactional
 * copy of themselves, through {@link BaseTransactional}.
 *
 * A subclass widens the context to depend on other services:
 *
 * @example
 * ```ts
 * type AssetServiceContext = ServiceContext<{
 *   resourceService: ResourceService
 * }>;
 *
 * class AssetService extends Service<AssetServiceContext> {
 *   async describeAsset(id: string) {
 *     const asset = await this.context.assetRepo.findById(id);
 *     // ...
 *   }
 * }
 * ```
 *
 * @human
 */
export class Service<
  TContext extends ServiceContext = ServiceContext,
> extends BaseTransactional<TContext> {
  /** Marks this service as one its holder rebinds when a transaction starts. */
  readonly [FOLLOWS_CONTEXT] = true;

  /**
   * Runs a use case and folds every failure into a {@link ServiceResult}.
   *
   * The returned result is a {@link ServiceExecution} that wraps the outcome of the operation,
   * capturing both successful results and failures.
   */
  execute<T>(fn: (this: this, context: TContext) => Promise<T>): ServiceExecution<T> {
    return new ServiceExecution(
      // The async IIFE turns a synchronous throw inside `fn` into a rejection, so
      // assertions and other guards take the same failure path as async errors. ~vz
      (async () => fn.call(this, this.context))()
        .then((data) => ({ ok: true, data }) as const)
        .catch(this.context.toServiceFailure ?? toServiceFailure),
    );
  }

  /** @deprecated Use {@link executeTransaction} instead (leftover from @softzweig/suitcase) */
  transactional<T>(fn: (this: this, context: TContext) => Promise<T>): ServiceExecution<T> {
    return this.executeTransaction(fn);
  }

  /** @deprecated Use {@link executeNonTransaction} instead (leftover from @softzweig/suitcase) */
  nontransactional<T>(fn: (this: this, context: TContext) => Promise<T>): ServiceExecution<T> {
    return this.executeNonTransaction(fn);
  }

  executeTransaction<T>(fn: (this: this, context: TContext) => Promise<T>): ServiceExecution<T> {
    return this.execute(() =>
      this.transaction(function (ctx) {
        this.assertTransaction();
        return fn.call(this, ctx);
      }),
    );
  }

  executeNonTransaction<T>(fn: (this: this, context: TContext) => Promise<T>): ServiceExecution<T> {
    return this.execute((ctx) => {
      this.assertNotTransaction();
      return fn.call(this, ctx);
    });
  }
}

/**
 * The default converter from an unknown error to a structured service failure.
 *
 * @note
 * This only represents a very basic conversion, a consumer like yourself should most likely
 * implement a more comprehensive error handling strategy tailored to your application's needs,
 * falling back to this implementation.
 *
 * @example
 * ```ts
 * // Example use: you may want to extend the default error handling
 * function toAppFailure(error: unknown): ServiceFailure {
 *   if (error instanceof StorageError) { // <- example
 *     return mapStorageErrorToFailure(error);
 *   }
 *
 *   return toServiceFailure(error); // <- fallback to the default conversion
 * }
 * ```
 *
 * @human
 */
export function toServiceFailure(error: unknown) {
  if (error instanceof ServiceError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details,
    } satisfies ServiceFailure;
  }

  return {
    ok: false,
    code: ServiceErrorCode.UNKNOWN,
    message: "Unexpected failure",
  } satisfies ServiceFailure;
}
