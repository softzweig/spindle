import type { ServiceResult } from "../result.js";
import { ServiceError } from "./service.error.js";

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
  result(): Promise<ServiceResult<T>> {
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
   * branch on the outcome should use {@link result} instead.
   *
   * @see {@link result}
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
   * @see {@link result}
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
   * (e.g. {@link unwrap}, {@link discard}, {@link result}, ...) actually triggers the
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
   * @see {@link result}
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
      return next.result();
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
