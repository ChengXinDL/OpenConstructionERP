// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Feature test for the collapse -> re-open flow of a module info card.
//
// Founder 2026-07-23: a DismissibleInfo card can be collapsed into a button
// next to "How it works" and re-opened from there, and the choice is saved
// per-user (localStorage now, server on the next boot). These tests drive the
// real DismissibleInfo + ModuleInfoButton pair (they talk through the real
// useModuleInfoStore registry and the real useInfoBlockPrefsStore) and assert:
//
//   1. Card starts expanded; no re-open pill.
//   2. Collapsing hides the card and shows the pill; the choice lands in the
//      per-user store + its localStorage bucket and is pushed to the server.
//   3. The pill re-opens the card and clears the collapsed flag.
//   4. A legacy per-browser `oce.intro.<key>` flag still collapses the card
//      once, so preferences set before this change carry over.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/* ── i18n shim — return the defaultValue verbatim. ─────────────────────── */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

/* ── api shim — the prefs store syncs through these; keep them off-network. */
const apiMocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({
  apiGet: apiMocks.apiGet,
  apiPut: apiMocks.apiPut,
}));

import { DismissibleInfo } from './DismissibleInfo';
import { ModuleInfoButton } from './ModuleInfoButton';
import { useInfoBlockPrefsStore } from '@/stores/useInfoBlockPrefsStore';
import { useModuleInfoStore } from '@/stores/useModuleInfoStore';

function Harness({ storageKey }: { storageKey: string }) {
  return (
    <>
      <ModuleInfoButton />
      <DismissibleInfo storageKey={storageKey} title="Test card">
        Body copy
      </DismissibleInfo>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  apiMocks.apiGet.mockResolvedValue({ blocks: {} });
  apiMocks.apiPut.mockResolvedValue({ blocks: {} });
  apiMocks.apiPut.mockClear();
  // Reset the two singleton stores between tests.
  useInfoBlockPrefsStore.setState({ blocks: {}, hydrated: false });
  useModuleInfoStore.setState({ entries: [], guideKeys: [] });
});

afterEach(() => {
  cleanup();
});

describe('module info card collapse / re-open', () => {
  it('starts expanded with no re-open pill', () => {
    render(<Harness storageKey="ib-a" />);
    expect(screen.getByText('Test card')).toBeTruthy();
    expect(screen.queryByTestId('module-info-button')).toBeNull();
  });

  it('collapses into the pill and re-opens from it', () => {
    render(<Harness storageKey="ib-b" />);

    // Collapse via the card title (a dedicated toggle button).
    fireEvent.click(screen.getByText('Test card'));

    // Card is gone from the flow; the re-open pill appears.
    expect(screen.queryByText('Test card')).toBeNull();
    const pill = screen.getByTestId('module-info-button');
    expect(pill).toBeTruthy();
    expect(useInfoBlockPrefsStore.getState().blocks['ib-b']).toBe(true);

    // Re-open from the pill.
    fireEvent.click(pill);
    expect(screen.getByText('Test card')).toBeTruthy();
    expect(useInfoBlockPrefsStore.getState().blocks['ib-b']).toBe(false);
    expect(screen.queryByTestId('module-info-button')).toBeNull();
  });

  it('persists the collapse to the per-user store and pushes it to the server', async () => {
    render(<Harness storageKey="ib-sync" />);
    fireEvent.click(screen.getByText('Test card'));

    // localStorage bucket (instant offline) holds the flag.
    const bucket = JSON.parse(localStorage.getItem('oce.info-blocks') || '{}');
    expect(bucket?.state?.blocks?.['ib-sync']).toBe(true);

    // Debounced write-through reaches the server endpoint.
    await waitFor(() =>
      expect(apiMocks.apiPut).toHaveBeenCalledWith(
        '/v1/users/me/info-blocks/',
        expect.objectContaining({ blocks: expect.objectContaining({ 'ib-sync': true }) }),
      ),
    );
  });

  it('honours a legacy oce.intro.<key> flag as a one-time fallback', () => {
    localStorage.setItem('oce.intro.ib-legacy', '1');
    render(<Harness storageKey="ib-legacy" />);

    // Collapsed on first render from the legacy flag, pill available.
    expect(screen.queryByText('Test card')).toBeNull();
    expect(screen.getByTestId('module-info-button')).toBeTruthy();
  });
});
