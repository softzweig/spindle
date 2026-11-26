import { ServiceErrorCode } from "../result.js";

/** What an authorization hook may answer: only `true` permits, a string refuses with its reason. */
export type AuthorizationVerdict = boolean | undefined | null | string;

/**
 * A domain outcome that services throw and consumers translate into their own
 * transport (HTTP status, tRPC code, queue retry policy).
 *
 * Lives in server, not core: it is a thrown error, so nobody outside the
 * server process can receive it. Core carries only what crosses a boundary —
 * {@link ServiceErrorCode} and {@link ServiceFailure}.
 *
 * @human
 */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }

  static of(code: ServiceErrorCode, message: string, details?: Record<string, unknown>) {
    return new ServiceError(code, message, details);
  }

  static notFound(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.NOT_FOUND, message, details);
  }

  static invalidInput(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.INVALID_INPUT, message, details);
  }

  static forbidden(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.FORBIDDEN, message, details);
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.CONFLICT, message, details);
  }

  static preconditionFailed(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.PRECONDITION_FAILED, message, details);
  }

  static unavailable(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.UNAVAILABLE, message, details);
  }

  static unknown(message: string, details?: Record<string, unknown>) {
    return ServiceError.of(ServiceErrorCode.UNKNOWN, message, details);
  }

  static assert(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
    code: ServiceErrorCode = ServiceErrorCode.PRECONDITION_FAILED,
  ): asserts condition {
    if (condition) return;
    throw ServiceError.of(code, message, details);
  }

  /** @deprecated Use `assert` instead (defaults to PRECONDITION_FAILED) */
  static assertPrecondition(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
  ) {
    ServiceError.assert(condition, message, details);
  }

  static assertFound(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, ServiceErrorCode.NOT_FOUND);
  }

  static assertConflict(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, ServiceErrorCode.CONFLICT);
  }

  static assertAllowed(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, ServiceErrorCode.FORBIDDEN);
  }

  static assertValidInput(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, ServiceErrorCode.INVALID_INPUT);
  }

  static assertAvailable(condition: unknown, message: string, details?: Record<string, unknown>) {
    ServiceError.assert(condition, message, details, ServiceErrorCode.UNAVAILABLE);
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
