// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Normalize an API list response that may return either a bare array
 * or an object with an `items` array.  Used as a `select` transform
 * in React Query to provide a consistent array to components.
 *
 * Internal ref: ddc-lineage:a17f93c4-core-02
 */
export function normalizeListResponse<T>(data: T[] | { items: T[] } | undefined | null): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ('items' in data && Array.isArray(data.items)) return data.items;
  return [];
}

/** Everything a caller needs to know about a paged read, including what it did not get. */
export interface PagedResult<T> {
  items: T[];
  /** True when the ceiling stopped the read, so `items` is not the whole set. */
  truncated: boolean;
  /** The ceiling that stopped it, for a message the user can act on. */
  ceiling: number;
}

/**
 * Read every page of a list endpoint instead of the first one.
 *
 * List routes here cap `limit` at 100, so a single request is a page, not a
 * data set. Passing that page straight into a sum, a count or an export is the
 * bug this exists to prevent: the number looks authoritative and is short by
 * however many records sit past the cap.
 *
 * The ceiling is a memory guard, not a page size. When it is reached the result
 * says so, so a partial read can never be presented as a complete one.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[] | { items: T[] } | undefined | null>,
  options: { pageSize?: number; ceiling?: number } = {},
): Promise<PagedResult<T>> {
  const pageSize = options.pageSize ?? 100;
  const ceiling = options.ceiling ?? 10_000;
  const items: T[] = [];

  for (let offset = 0; offset < ceiling; offset += pageSize) {
    const page = normalizeListResponse<T>(await fetchPage(offset, Math.min(pageSize, ceiling - offset)));
    items.push(...page);
    // A short page is the end of the data. An empty one guards against a route
    // that ignores offset, which would otherwise loop until the ceiling.
    if (page.length < pageSize) return { items, truncated: false, ceiling };
  }

  return { items, truncated: true, ceiling };
}
