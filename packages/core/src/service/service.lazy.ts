/**
 * A context member that is resolved when it is read.
 *
 * The point is construction order: two services that depend on each other cannot both
 * be created before the other exists, so one of them is handed this instead. A service
 * does not see the difference, `context.other` is the dependency either way.
 */
export class Lazy<T> {
  constructor(readonly resolve: () => T) {}
}

/**
 * Hands a context member over as a {@link Lazy}, resolved the first time it is read.
 *
 * The value is typed as the dependency itself, not as the wrapper: a service reads its
 * context, never the placeholder, and a wrapped dependency keeps working the same way.
 *
 * @note
 * In a mutual pair, annotate the two constants (or declare them as typed fields). Each
 * context names the other service, so the initialiser cannot be the source of its own
 * type.
 */
export function lazy<T>(resolve: () => T): T {
  // The wrapper never reaches a service, the constructor swaps it for a getter.
  return new Lazy(resolve) as unknown as T;
}
