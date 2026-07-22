// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * ``takeoffApi.list`` must fetch ALL measurement pages, not just the first
 * (issue #377). The endpoint pages at 500 rows and the old client fetched one
 * page, so a document past the page size silently lost its oldest rows on
 * reload. These tests pin the pagination contract: page to exhaustion, stop on
 * a short page, de-duplicate by id, and reject (not truncate) on a page error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiGet = vi.fn(async (..._args: unknown[]) => [] as unknown);

vi.mock('@/shared/lib/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

// The list helper short-circuits when the module is disabled; force it on.
vi.mock('@/shared/lib/moduleProbe', () => ({
  isModuleLoaded: vi.fn(async () => true),
}));

import { takeoffApi } from '../api';

const rows = (n: number, startId: number) =>
  Array.from({ length: n }, (_v, i) => ({ id: `m${startId + i}` }));

beforeEach(() => {
  apiGet.mockReset();
});

describe('takeoffApi.list pagination (issue #377)', () => {
  it('returns a single short page without a second request', async () => {
    apiGet.mockResolvedValueOnce(rows(3, 0));
    const result = await takeoffApi.list('proj-1');
    expect(result).toHaveLength(3);
    expect(apiGet).toHaveBeenCalledTimes(1);
    // First page starts at offset 0 with the max page size.
    expect(String(apiGet.mock.calls[0]![0])).toContain('offset=0');
    expect(String(apiGet.mock.calls[0]![0])).toContain('limit=500');
  });

  it('pages to exhaustion and concatenates every row', async () => {
    apiGet
      .mockResolvedValueOnce(rows(500, 0)) // full page -> keep going
      .mockResolvedValueOnce(rows(500, 500)) // full page -> keep going
      .mockResolvedValueOnce(rows(37, 1000)); // short page -> stop
    const result = await takeoffApi.list('proj-1', 'doc-1');
    expect(result).toHaveLength(1037);
    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(String(apiGet.mock.calls[1]![0])).toContain('offset=500');
    expect(String(apiGet.mock.calls[2]![0])).toContain('offset=1000');
  });

  it('de-duplicates rows that repeat across a page boundary', async () => {
    // A row created mid-fetch can shift later pages and repeat; dedupe by id.
    apiGet
      .mockResolvedValueOnce(rows(500, 0))
      .mockResolvedValueOnce([{ id: 'm499' }, ...rows(10, 500)]); // m499 repeats
    const result = await takeoffApi.list('proj-1');
    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result).toHaveLength(510);
  });

  it('rejects (all-or-nothing) when a page request fails', async () => {
    apiGet
      .mockResolvedValueOnce(rows(500, 0))
      .mockRejectedValueOnce(new Error('boom'));
    await expect(takeoffApi.list('proj-1')).rejects.toThrow('boom');
  });
});
