import type { Entity } from "@softzweig/spindle-core/repository";

/**
 * The rows one memory repository keeps, in insertion order.
 *
 * Rows are copied in and out, so a caller holding a value cannot change what is
 * stored, and a transaction can put a snapshot back without disturbing the values
 * it already handed out. Nothing here survives the process.
 */
export class MemoryStore<TEntity extends Entity = Entity> {
  private readonly rows = new Map<TEntity["id"], TEntity>();

  /** Every stored row, as copies, in insertion order. */
  get all(): TEntity[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  /** The row for `id`, as a copy, or `undefined` when it is absent. */
  get(id: TEntity["id"]): TEntity | undefined {
    const row = this.rows.get(id);

    return row && { ...row };
  }

  /** Stores `entity` under its id, replacing any row already there. */
  set(entity: TEntity): TEntity {
    const row = { ...entity };
    this.rows.set(entity.id, row);

    return { ...row };
  }

  /** Removes and returns the row for `id`, or `undefined` when it is absent. */
  delete(id: TEntity["id"]): TEntity | undefined {
    const row = this.get(id);
    this.rows.delete(id);
    return row;
  }

  /** Drops every row. */
  clear(): void {
    this.rows.clear();
  }

  /**
   * Runs `work` against these rows, putting the current ones back if it throws.
   *
   * A nested call snapshots again, so the inner scope that fails undoes only its
   * own writes while an outer failure still discards everything.
   */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const snapshot = new Map(this.rows);

    try {
      return await work();
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private restore(snapshot: ReadonlyMap<TEntity["id"], TEntity>): void {
    this.rows.clear();

    for (const [id, row] of snapshot) this.rows.set(id, row);
  }
}
