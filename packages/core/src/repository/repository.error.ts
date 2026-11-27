import { SpindleError, SpindleErrorCode } from "../result.js";

/**
 * A repository failure a caller is expected to branch on.
 *
 * A programmer mistake stays a JavaScript error: a `RangeError` for a page limit that is
 * not a positive integer, a `TypeError` for a filter or cursor the backend cannot express.
 * An operation that is well formed but cannot succeed throws this instead, so a caller
 * matches on `code` rather than on a message.
 *
 * An adapter reports the codes its backend can detect, such as a unique index rejecting an
 * insert; anything it cannot classify is left as the driver's own error.
 *
 * @note
 * It extends {@link SpindleError} like `ServiceError`, because a caller maps both the same
 * way, and stays a separate class all the same: a repository reports the state of its
 * storage, a service reports the outcome of a use case. ~vz
 *
 * @example
 * ```ts
 * try {
 *   await assets.patch(id, { note: "reviewed" });
 * } catch (error) {
 *   if (error instanceof RepositoryError) {
 *     // error.code is a SpindleErrorCode, so it maps like a service failure
 *   }
 * }
 * ```
 *
 * @human
 */
export class RepositoryError extends SpindleError {
  constructor(code: SpindleErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "RepositoryError";
  }

  static of(code: SpindleErrorCode, message: string, details?: Record<string, unknown>) {
    return new RepositoryError(code, message, details);
  }

  /** No row matches the id an update was addressed to. */
  static notFound(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.NOT_FOUND, message, details);
  }

  /** The row breaks a column rule the backend enforces, such as a not-null constraint. */
  static invalidInput(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.INVALID_INPUT, message, details);
  }

  /** The caller is not allowed to read or write these rows. */
  static forbidden(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.FORBIDDEN, message, details);
  }

  /** Existing state contradicts the write, such as a duplicate unique key. */
  static conflict(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.CONFLICT, message, details);
  }

  /** The write is not allowed in the current state, such as deleting a claimed row. */
  static preconditionFailed(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.PRECONDITION_FAILED, message, details);
  }

  /** The backend cannot be reached; the same write may succeed later. */
  static unavailable(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.UNAVAILABLE, message, details);
  }

  /** A failure the adapter could not classify. */
  static unknown(message: string, details?: Record<string, unknown>) {
    return RepositoryError.of(SpindleErrorCode.UNKNOWN, message, details);
  }
}
