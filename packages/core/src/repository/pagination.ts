/** One page request: its size, where it resumes, and what it matches. */
export type ListRequest<TFilter, TCursor> = Readonly<{
  /** Maximum number of items the page may hold; a positive integer. */
  limit: number;
  /** Where the page starts; omitted for the first page. */
  cursor?: TCursor;
  filter?: TFilter;
}>;

/** One page of items, and the cursor that continues it. */
export type Page<TItem, TCursor> = Readonly<{
  items: readonly TItem[];
  /** The cursor for the next page, or `null` when this one is the last. */
  nextCursor: TCursor | null;
}>;

/**
 * How a repository pages: the cursor that points at a row.
 *
 * Adapters extend it with what their own queries need, the ordering keys for SQL, a
 * comparator for an in-memory store, and hand the whole definition to the base.
 *
 * @human
 */
export type Paging<TEntity, TCursor> = Readonly<{
  read(entity: TEntity): TCursor;
}>;

/**
 * Slices the rows a backend fetched into a page.
 *
 * `rows` holds up to one more than the page size, in the repository's cursor order;
 * anything past `limit` only proves another page exists.
 */
export function toPage<TItem, TCursor>(
  rows: readonly TItem[],
  limit: number,
  read: (item: TItem) => TCursor,
): Page<TItem, TCursor> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return { items, nextCursor: rows.length > limit && last ? read(last) : null };
}
