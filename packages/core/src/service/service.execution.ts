import type { ServiceResult } from "../result.js";
import { ServiceError } from "./service.error.js";

/** The data one execution resolves to. */
export type ServiceExecutionValue<T> = T extends ServiceExecution<infer TValue> ? TValue : never;

/** The data a set of executions resolves to, keeping the tuple's shape. */
export type ServiceExecutionValues<T extends readonly ServiceExecution<unknown>[]> = {
  -readonly [K in keyof T]: ServiceExecutionValue<T[K]>;
};

/** One outcome per execution, keeping the tuple's shape. */
export type ServiceExecutionSettledValues<T extends readonly ServiceExecution<unknown>[]> = {
  -readonly [K in keyof T]: ServiceResult<ServiceExecutionValue<T[K]>>;
};

/**
 * A prepared service call that runs on demand.
 *
 * A service method returns one of these instead of a promise: the work is
 * described but not started. The executors below perform it on first use, and the
 * promise they produced is kept, so inspecting an execution from several places
 * observes a single result rather than one per call. Steps compose with
 * {@link ServiceExecution.pipe}, and the executors run the whole chain.
 *
 * @human
 */
export class ServiceExecution<T> {
  private promise: Promise<ServiceResult<T>> | null = null;

  protected constructor(private readonly lazyExecutor: () => Promise<ServiceResult<T>>) {}

  /** An execution that runs `lazyExecutor` as soon as it is executed. */
  static of<T>(lazyExecutor: () => Promise<ServiceResult<T>>) {
    return new ServiceExecution(lazyExecutor);
  }

  /** An execution already settled with a result, without running anything. */
  static fromResult<T>(result: ServiceResult<T>) {
    return new ServiceExecution(() => Promise.resolve(result));
  }

  /** An execution already settled with a failure carrying `error`. */
  static fromError<T>(error: ServiceError) {
    return ServiceExecution.fromResult<T>({
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }

  /**
   * _[Composable]_
   * Prepares a set of executions to run together, in parallel, once executed.
   *
   * The first failure wins and becomes the outcome of the combined execution. The
   * others are not cancelled: as with `Promise.all`, work that already started runs to
   * completion, its outcome simply is not observed. Nothing is ran until a terminal
   * executor like `unwrap` or `result` is called.
   *
   * @example
   * ```ts
   * const [asset, usage] = await ServiceExecution.all([findAsset(id), usageOf(id)]).unwrap();
   * ```
   *
   * @see {@link ServiceExecution.allSettled}
   * @human
   */
  static all<TExecutions extends readonly ServiceExecution<unknown>[]>(
    executions: readonly [...TExecutions],
  ): ServiceExecution<ServiceExecutionValues<TExecutions>> {
    return ServiceExecution.of(async () => {
      const results = await runTogether(executions);
      const data: unknown[] = [];

      for (const result of results) {
        if (!result.ok) return result;
        data.push(result.data);
      }

      // The element types narrow back through the mapped tuple, which `map` cannot say.
      return { ok: true, data } as { ok: true; data: ServiceExecutionValues<TExecutions> };
    });
  }

  /**
   * _[Composable]_
   * Prepares a set of executions to run together, keeping every outcome.
   *
   * Unlike {@link ServiceExecution.all} this never fails: the data is one
   * {@link ServiceResult} per execution, in the order they were given, so the caller
   * decides what to do with the failures it finds. Nothing is ran until a terminal
   * executor like `unwrap` or `result` is called.
   *
   * @example
   * ```ts
   * const results = await ServiceExecution.allSettled([findAsset(a), findAsset(b)]).unwrap();
   * const assets = results.flatMap((result) => (result.ok ? [result.data] : []));
   * ```
   *
   * @see {@link ServiceExecution.all}
   * @human
   */
  static allSettled<TExecutions extends readonly ServiceExecution<unknown>[]>(
    executions: readonly [...TExecutions],
  ): ServiceExecution<ServiceExecutionSettledValues<TExecutions>> {
    return ServiceExecution.of(async () => ({
      ok: true,
      data: (await runTogether(executions)) as ServiceExecutionSettledValues<TExecutions>,
    }));
  }

  /**
   * _[Terminal]_
   * Executes the call and returns its result, failures included.
   *
   * The first execution actually runs the prepared work, and subsequent calls observe
   * the same outcome. The underlying prepared work is only executed once through this.
   *
   * @see {@link unwrap}
   * @see {@link discard}
   * @human
   */
  run(): Promise<ServiceResult<T>> {
    return this.executeOnce();
  }

  /**
   * _[Terminal]_
   * Executes the call and returns its data, throwing {@link ServiceError} on failure.
   *
   * The first execution actually runs the prepared work, and subsequent calls observe
   * the same outcome. The underlying prepared work is only executed once through this.
   *
   * @note
   * For a boundary that cannot return a failure value; a caller that wants to
   * branch on the outcome should use {@link run} instead.
   *
   * @see {@link run}
   * @see {@link discard}
   * @human
   */
  async unwrap(): Promise<T> {
    const result = await this.executeOnce();
    if (result.ok) return result.data;
    throw ServiceError.of(result.code, result.message, result.details);
  }

  /**
   * _[Terminal]_
   * Executes the call and discards its outcome, ignoring any failures. **Never** throws.
   *
   * The first execution actually runs the prepared work, and subsequent calls observe
   * the same outcome. The underlying prepared work is only executed once through this.
   *
   * @see {@link run}
   * @see {@link unwrap}
   * @human
   */
  async discard(): Promise<void> {
    await this.executeOnce().catch(() => undefined);
  }

  /**
   * _[Composable]_
   * Pipes the data of this execution into the next step.
   *
   * Nothing runs yet: the step is called when the pipeline is executed, with the data
   * of this execution, and returns either the next {@link ServiceExecution} or a plain
   * value. A failure anywhere in the chain skips the remaining steps and travels to the
   * end, so only the terminal executor has to deal with it. Only a terminal marked action
   * (e.g. {@link unwrap}, {@link discard}, {@link run}, ...) actually triggers the
   * execution of the pipeline.
   *
   * @example
   * ```ts
   * service.findAsset(id).pipe((asset) => service.signAsset(asset)).unwrap();
   * ```
   *
   * @note
   * A step that throws rejects the execution instead of folding; steps are service
   * calls, which fold their own failures.
   *
   * @see {@link run}
   * @see {@link unwrap}
   * @human
   */
  pipe<U>(step: (data: T) => U | ServiceExecution<U> | PromiseLike<U>): ServiceExecution<U> {
    return ServiceExecution.of(async () => {
      const result = await this.executeOnce();
      if (!result.ok) return result;

      const next = await step(result.data);
      if (!(next instanceof ServiceExecution)) {
        return { ok: true, data: next };
      }
      return next.run();
    });
  }

  /** Performs the prepared work once and keeps the promise it produced. */
  private executeOnce() {
    // Started inside `Promise.resolve().then`, so a synchronous throw in the
    // executor reaches the caller as a rejection instead of escaping the call. ~vz
    this.promise ??= Promise.resolve().then(() => this.lazyExecutor());

    return this.promise;
  }
}

/** Runs every execution and collects the outcomes, in the order they were given. */
function runTogether(
  executions: readonly ServiceExecution<unknown>[],
): Promise<ServiceResult<unknown>[]> {
  return Promise.all(executions.map((execution) => execution.run()));
}
