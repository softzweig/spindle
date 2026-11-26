import type { ServiceResult } from "../result.js";
import { ServiceError } from "./service.error.js";

/**
 * An in-flight service call that resolves to a {@link ServiceResult}.
 *
 * Every method observes the same promise, so the underlying operation runs once
 * regardless of how often the execution is inspected.
 */
export class ServiceExecution<T> {
  constructor(private readonly promise: Promise<ServiceResult<T>>) {}

  /** Returns the result of the execution, without throwing {@link ServiceError} on error. */
  result(): Promise<ServiceResult<T>> {
    return this.promise;
  }

  /** Returns the successful result of the execution, or throws {@link ServiceError} on error. */
  async unwrap(): Promise<T> {
    const result = await this.promise;
    if (result.ok) return result.data;
    throw ServiceError.of(result.code, result.message, result.details);
  }

  /** Discards the execution result, if any, explicitly. **Never** throws. */
  async discard(): Promise<void> {
    await this.promise.catch(() => undefined);
  }
}
