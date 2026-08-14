// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The release check asks api.github.com anonymously, and the anonymous rate
// limit is per IP, so an office behind one address gets 403 for the rest of
// the hour. Only a successful answer was cached, so every mount in every tab
// asked again and the browser logged another failed request - on a screen
// being recorded, one per frame.
//
// Two properties are pinned here, and they fail differently. A failure has to
// be remembered, or the retry storm comes back. And a cache entry that says
// "you are up to date" has to end the question, which the hook's own guard
// did not do: it returned early only when the cached release was NEWER, so
// the common case, an install already on the latest version, fell through to
// the network on every single mount and the cache guarded nothing.
//
// Run:  npx vitest run src/shared/ui/__tests__/updateCheckerNegativeCache.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpdateCheck } from '../UpdateChecker';

const CACHE_KEY = 'oe_update_cache_v1';

function fetchReturning(status: number, body: unknown = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the release check remembers a failed answer', () => {
  it('asks once when GitHub refuses, not once per mount', async () => {
    const fetchMock = fetchReturning(403, { message: 'API rate limit exceeded' });
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();

    // A second mount inside the TTL - another tab, a route change, the same
    // hook on the About page - must read the failure rather than repeat it.
    const second = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.result.current).toBeNull();
  });

  it('records the failure as an entry with no release, not as an absent entry', async () => {
    vi.stubGlobal('fetch', fetchReturning(403));

    renderHook(() => useUpdateCheck());

    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) as string);
    expect(cached.data).toBeNull();
    expect(typeof cached.fetched_at).toBe('number');
  });

  it('remembers a refused connection the same way', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUpdateCheck());
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());

    renderHook(() => useUpdateCheck());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe('the release check stops at a cache entry that is not newer', () => {
  it('does not ask again when the cached release is the version already running', async () => {
    // Version 0.0.1 cannot be newer than anything the app ships, so this is
    // the "already up to date" entry. Before the fix this fell through the
    // guard and went to the network anyway.
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fetched_at: Date.now(),
        data: { version: '0.0.1', notes: '', url: '', publishedAt: '' },
      }),
    );
    const fetchMock = fetchReturning(200, { tag_name: 'v99.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(result.current).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still surfaces a cached release that is newer', async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fetched_at: Date.now(),
        data: { version: '999.0.0', notes: 'note', url: 'https://example.invalid', publishedAt: '' },
      }),
    );
    const fetchMock = fetchReturning(200, { tag_name: 'v999.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(result.current?.version).toBe('999.0.0'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
