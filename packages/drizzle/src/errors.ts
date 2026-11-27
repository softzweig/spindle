import { RepositoryError } from "@softzweig/spindle-core/repository";
import { SpindleErrorCode } from "@softzweig/spindle-core/result";

/**
 * The code a driver raises for a constraint, and the failure it stands for.
 *
 * `23505` is Postgres' unique violation; SQLite names its constraints instead, and libSQL
 * reports a unique index and a primary key separately. A row is all a new driver needs.
 */
const constraintCodes: Readonly<Record<string, SpindleErrorCode>> = {
  "23505": SpindleErrorCode.CONFLICT,
  SQLITE_CONSTRAINT_UNIQUE: SpindleErrorCode.CONFLICT,
  SQLITE_CONSTRAINT_PRIMARYKEY: SpindleErrorCode.CONFLICT,
  "23502": SpindleErrorCode.INVALID_INPUT,
  "23503": SpindleErrorCode.INVALID_INPUT,
  "23514": SpindleErrorCode.INVALID_INPUT,
  SQLITE_CONSTRAINT_NOTNULL: SpindleErrorCode.INVALID_INPUT,
  SQLITE_CONSTRAINT_FOREIGNKEY: SpindleErrorCode.INVALID_INPUT,
  SQLITE_CONSTRAINT_CHECK: SpindleErrorCode.INVALID_INPUT,
};

/** The most specific code a driver reported, when it reported one. */
function driverCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const { extendedCode, code } = error as { extendedCode?: unknown; code?: unknown };
  if (typeof extendedCode === "string") return extendedCode;

  return typeof code === "string" ? code : undefined;
}

/** How far down a `cause` chain to look before deciding an error is not a constraint. */
const MAX_CAUSE_DEPTH = 8;

/**
 * An error and everything it wraps, outermost first.
 *
 * Drizzle reports a failed statement as its own error carrying the driver's as `cause`, and
 * libSQL nests one more level, so the constraint code is never on the error that is thrown.
 */
function chainOf(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;

  while (current != null && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  return chain;
}

/**
 * Turns a driver failure into the repository error a caller can branch on.
 *
 * Postgres and SQLite name the same constraint differently, so both vocabularies are
 * recognised here instead of at every call site. The message kept is the one the driver
 * wrote, not the wrapper that embeds the statement and its parameters. A failure this does
 * not recognise is returned untouched, with its original stack, rather than being folded
 * into `unknown`.
 *
 * @see {@link RepositoryError}
 * @human
 */
export function toRepositoryError(error: unknown): unknown {
  for (const candidate of chainOf(error)) {
    const driver = driverCode(candidate);
    if (!driver) continue;

    const code = constraintCodes[driver];
    if (!code) continue;

    const message = candidate instanceof Error ? candidate.message : String(candidate);

    return RepositoryError.of(code, message, { driverCode: driver });
  }

  return error;
}
