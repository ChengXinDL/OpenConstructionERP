// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Tests for the PDF revision-compare -> variation handoff (Item 17).
 *
 * Mirrors DwgDrawingCompareDrawer.test.tsx for the PDF path:
 *   1. The "Create variation from delta" button is DISABLED when the diff
 *      reports no measurement changes.
 *   2. It is ENABLED with at least one change, and clicking it calls
 *      takeoffApi.createVariation with the project + document ids.
 *   3. On success a toast names the created draft code and offers a
 *      "View variation" action.
 */

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PdfCompareDrawer } from '../PdfCompareDrawer';
import { takeoffApi } from '../api';
import { useToastStore } from '@/stores/useToastStore';

vi.mock('../api', () => ({
  takeoffApi: {
    compare: vi.fn(),
    createVariation: vi.fn(),
  },
}));

const DOCS = [
  { id: 'doc-b', filename: 'rev-b.pdf', pages: 3 },
  { id: 'doc-a', filename: 'rev-a.pdf', pages: 3 },
];

function diff(net: string | null, modified: number, truncation?: { limit: number; total: number }) {
  const compared = truncation ? truncation.limit : 4;
  return {
    project_id: 'p1',
    from_document_id: 'doc-a',
    to_document_id: 'doc-b',
    measurement_rows: [],
    summary: {
      measurements: { added: 0, removed: 0, modified, unchanged: 4 },
      net_cost_impact: net,
      cost_currency: net ? 'EUR' : null,
      from_measurement_count: compared,
      to_measurement_count: compared + modified,
      from_measurement_total: truncation ? truncation.total : 4,
      to_measurement_total: truncation ? truncation.total : 4 + modified,
      truncated: Boolean(truncation),
      truncation_limit: truncation ? truncation.limit : null,
    },
  };
}

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PdfCompareDrawer open onClose={vi.fn()} projectId="p1" documents={DOCS} />
    </QueryClientProvider>,
  );
}

describe('PdfCompareDrawer - create variation handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [], history: [] });
  });

  it('disables the button when there are no changes', async () => {
    (takeoffApi.compare as unknown as vi.Mock).mockResolvedValue(diff(null, 0));
    renderDrawer();
    const btn = await screen.findByTestId('takeoff-compare-create-variation');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(takeoffApi.createVariation).not.toHaveBeenCalled();
  });

  it('calls createVariation with the project + document ids on click', async () => {
    (takeoffApi.compare as unknown as vi.Mock).mockResolvedValue(diff('500.00', 1));
    (takeoffApi.createVariation as unknown as vi.Mock).mockResolvedValue({
      variation_request_id: 'vr-1',
      code: 'VR-007',
      estimated_cost_impact: '500.00',
      currency: 'EUR',
    });
    renderDrawer();

    const btn = await screen.findByTestId('takeoff-compare-create-variation');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() =>
      expect(takeoffApi.createVariation).toHaveBeenCalledWith('p1', 'doc-a', 'doc-b'),
    );
  });

  it('shows a success toast with a View variation action', async () => {
    (takeoffApi.compare as unknown as vi.Mock).mockResolvedValue(diff('500.00', 1));
    (takeoffApi.createVariation as unknown as vi.Mock).mockResolvedValue({
      variation_request_id: 'vr-1',
      code: 'VR-007',
      estimated_cost_impact: '500.00',
      currency: 'EUR',
    });
    renderDrawer();

    const btn = await screen.findByTestId('takeoff-compare-create-variation');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() => {
      const { toasts } = useToastStore.getState();
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe('success');
      expect(typeof toasts[0].action?.onClick).toBe('function');
    });
  });
});

describe('PdfCompareDrawer - truncated comparisons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [], history: [] });
  });

  it('stays quiet when the backend compared everything', async () => {
    (takeoffApi.compare as unknown as vi.Mock).mockResolvedValue(diff('500.00', 1));
    renderDrawer();
    await screen.findByTestId('takeoff-compare-create-variation');
    expect(screen.queryByTestId('takeoff-compare-truncated')).toBeNull();
  });

  it('warns that the compare stopped at the row ceiling', async () => {
    (takeoffApi.compare as unknown as vi.Mock).mockResolvedValue(
      diff('500.00', 1, { limit: 20000, total: 31500 }),
    );
    renderDrawer();
    const notice = await screen.findByTestId('takeoff-compare-truncated');
    expect(notice.textContent).toContain('20000');
  });

  it('reports the document totals, not the truncated compare counts', async () => {
    (takeoffApi.compare as unknown as vi.Mock).mockResolvedValue(
      diff('500.00', 1, { limit: 20000, total: 31500 }),
    );
    renderDrawer();
    await screen.findByTestId('takeoff-compare-truncated');
    // A user pricing a variation off this panel must not read the compared
    // count for a document that holds more. The drawer renders into a portal,
    // so read the document rather than the render container.
    expect(document.body.textContent).toContain('31500');
  });
});
