import { SpindleErrorCode } from "../result.js";

/** What an authorization hook may answer: only `true` permits, a string refuses with its reason. */
export type AuthorizationVerdict = boolean | undefined | null | string;

/**
 * A domain outcome that services throw and consumers translate into their own
 * transport (HTTP status, tRPC code, queue retry policy).
 *
 * This class and `RepositoryError` carry the same vocabulary and deliberately stay
 * separate: a repository reports the state of its storage, a service reports the
 * outcome of a use case. Repositories throw `RepositoryError`, services translate it,
 * and the default `toServiceFailure` understands both.
 *
 * @human
 */
export class ServiceError extends Error {
  constructor(
    readonly code: SpindleErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }

  static of(code: SpindleErrorCode, message: string, details?: Record<string, unknown>) {
    return new ServiceError(code, message, details);
  }

  static notFound(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.NOT_FOUND, message, details);
  }

  static invalidInput(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.INVALID_INPUT, message, details);
  }

  static forbidden(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.FORBIDDEN, message, details);
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.CONFLICT, message, details);
  }

  static preconditionFailed(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.PRECONDITION_FAILED, message, details);
  }

  static unavailable(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.UNAVAILABLE, message, details);
  }

  static unknown(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(SpindleErrorCode.UNKNOWN, message, details);
  }

  static assert(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
    code: SpindleErrorCode = SpindleErrorCode.PRECONDITION_FAILED,
  ): asserts condition {
    if (condition) return;
    throw ServiceError.of(code, message, details);
  }

  static assertFound(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, SpindleErrorCode.NOT_FOUND);
  }

  static assertConflict(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, SpindleErrorCode.CONFLICT);
  }

  static assertAllowed(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, SpindleErrorCode.FORBIDDEN);
  }

  static assertValidInput(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, SpindleErrorCode.INVALID_INPUT);
  }

  static assertAvailable(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, SpindleErrorCode.UNAVAILABLE);
  }

  /**
   * Enforces an authorization hook's verdict: only `true` permits. A string refuses, and is already
   * the message the caller is told about.
   */
  static assertPermitted(
    verdict: AuthorizationVerdict,
    details?: Record<string, unknown>,
  ): asserts verdict is true {
    if (verdict === true) return;

    const reason = typeof verdict === "string" && verdict.length > 0 ? verdict : "Not permitted";
    throw ServiceError.forbidden(reason, details);
  }
}
