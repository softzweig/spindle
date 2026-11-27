import { ServiceErrorCode } from "../result.js";

/**
 * A repository failure a caller is expected to branch on.
 *
 * A programmer mistake stays a JavaScript error: a `RangeError` for a page limit that is
 * not a positive integer, a `TypeError` for a filter or cursor the backend cannot express.
 * An operation that is well formed but cannot succeed throws this instead, so a caller
 * matches on `code` rather than on a message.
 *
 * @example
 * ```ts
 * try {
 *   await assets.patch(id, { note: "reviewed" });
 * } catch (error) {
 *   if (error instanceof RepositoryError) {
 *     // error.code is a ServiceErrorCode, so it maps like a service failure
 *   }
 * }
 * ```
 *
 * @human
 */
export class RepositoryError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RepositoryError";
  }

  /** No row matches the id an update was addressed to. */
  static notFound(message: string, details?: Record<string, unknown>) {
    return new RepositoryError(ServiceErrorCode.NOT_FOUND, message, details);
  }
}
