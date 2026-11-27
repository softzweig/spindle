import z from "zod";

/** A successful call, carrying the result payload. */
export type SpindleSuccess<T> = Readonly<{ ok: true; data: T }>;

export type SpindleFailure = z.infer<typeof SpindleFailureSchema>;

export type SpindleResult<T> = SpindleSuccess<T> | SpindleFailure;

export type SpindleErrorCode = (typeof SpindleErrorCode)[keyof typeof SpindleErrorCode];

/**
 * Failure categories Spindle reports to callers.
 *
 * Repositories and services share one vocabulary, so a caller branches on `code` instead of
 * on a backend-specific error: a repository throws `RepositoryError`, a service throws
 * `ServiceError`, and `toServiceFailure` folds either into a `SpindleFailure`.
 *
 * @human
 */
export const SpindleErrorCode = Object.freeze({
  /** The entity does not exist, or is not visible to the caller. */
  NOT_FOUND: "not_found",
  /** The input is malformed or breaks a domain rule. */
  INVALID_INPUT: "invalid_input",
  /** The caller is not allowed to perform this operation. */
  FORBIDDEN: "forbidden",
  /** The request contradicts existing state, e.g. a duplicate digest. */
  CONFLICT: "conflict",
  /** The operation is not allowed in the current state. */
  PRECONDITION_FAILED: "precondition_failed",
  /** A dependency is unavailable; the same request may succeed later. */
  UNAVAILABLE: "unavailable",
  /** A failure the caller could not classify. */
  UNKNOWN: "unknown",
});

/**
 * A failed call.
 *
 * `message` is for humans; `details` carries machine-readable context such as
 * the offending field, and stays free-form on purpose.
 *
 * @human
 */
export const SpindleFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(SpindleErrorCode),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** Success half of {@link SpindleResult}, for a given payload schema. */
export const SpindleSuccessSchema = <TPayload extends z.ZodType>(payload: TPayload) =>
  z.object({ ok: z.literal(true), data: payload });

/** Full {@link SpindleResult} schema, for a given payload schema. */
export const SpindleResultSchema = <TPayload extends z.ZodType>(payload: TPayload) =>
  z.discriminatedUnion("ok", [SpindleSuccessSchema(payload), SpindleFailureSchema]);
