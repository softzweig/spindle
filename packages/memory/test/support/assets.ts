import { randomUUID } from "node:crypto";
import type { EntityFilter } from "@softzweig/spindle-core/repository";

export type Asset = {
  readonly id: string;
  readonly key: string;
  readonly size: number;
  /** Nullable, so a filter on it exercises the null branch. */
  readonly note: string | null;
};

export type AssetFilter = EntityFilter<Asset>;

/** A filter that also requires `size`, the shape a repository can narrow to. */
export type AssetSizeFilter = EntityFilter<Asset> & { readonly size: number };

export const newAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: randomUUID(),
  key: `assets/${randomUUID()}`,
  size: 42,
  note: null,
  ...overrides,
});
