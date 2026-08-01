// @ts-nocheck
// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Tests for the drawing-sheet index.
 *
 * The page was written complete but never routed, so nothing had ever
 * rendered it against a response. These drive it through the real endpoints
 * it calls - /v1/documents/sheets/ and .../disciplines/ - with the network
 * stubbed at ``apiGet``, and cover the two behaviours a user depends on:
 * the discipline chips and the free-text search.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from '@/shared/lib/api';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { SheetsIndexPage } from './SheetsIndexPage';

const SHEETS = [
  {
    id: 'sheet-1',
    sheet_number: 'A-101',
    sheet_title: 'Ground Floor Plan',
    discipline: 'Architectural',
    revision: 'C',
    scale: '1:100',
    document_id: 'doc-1',
    page_number: 1,
  },
  {
    id: 'sheet-2',
    sheet_number: 'S-201',
    sheet_title: 'Foundation Details',
    discipline: 'Structural',
    revision: 'A',
    scale: '1:50',
    document_id: 'doc-2',
    page_number: 4,
  },
];

const DISCIPLINES = ['Architectural', 'Structural'];

/** Route each stubbed URL to its payload, so a wrong URL fails loudly. */
function routeApi(sheets = SHEETS, disciplines = DISCIPLINES) {
  (apiGet as any).mockImplementation((url: string) => {
    if (url.startsWith('/v1/projects/')) {
      return Promise.resolve([{ id: 'proj-1', name: 'Riverside HQ' }]);
    }
    if (url.startsWith('/v1/documents/sheets/disciplines/')) {
      return Promise.resolve(disciplines);
    }
    if (url.startsWith('/v1/documents/sheets/')) {
      return Promise.resolve(sheets);
    }
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sheets']}>
        <SheetsIndexPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SheetsIndexPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectContextStore.getState().clearProject();
    useProjectContextStore.getState().setActiveProject('proj-1', 'Riverside HQ');
  });

  it('lists the sheets returned for the active project', async () => {
    routeApi();

    renderPage();

    expect(await screen.findByText('A-101')).toBeInTheDocument();
    expect(screen.getByText('Ground Floor Plan')).toBeInTheDocument();
    expect(screen.getByText('S-201')).toBeInTheDocument();
    expect(screen.getByText('Foundation Details')).toBeInTheDocument();
  });

  it('scopes the request to the active project', async () => {
    routeApi();

    renderPage();

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/documents/sheets/?project_id=proj-1'),
      ),
    );
  });

  it('filters to one discipline when its chip is clicked', async () => {
    routeApi();

    renderPage();

    // Wait for both rows before filtering, so a chip that does nothing
    // cannot pass by virtue of the list not having rendered yet.
    expect(await screen.findByText('A-101')).toBeInTheDocument();
    expect(screen.getByText('S-201')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Structural/ }));

    await waitFor(() => expect(screen.queryByText('A-101')).not.toBeInTheDocument());
    expect(screen.getByText('S-201')).toBeInTheDocument();
  });

  it('searches across number, title, discipline and revision', async () => {
    routeApi();

    renderPage();

    expect(await screen.findByText('A-101')).toBeInTheDocument();

    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: 'foundation' } });

    await waitFor(() => expect(screen.queryByText('A-101')).not.toBeInTheDocument());
    expect(screen.getByText('S-201')).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare table when there are no sheets', async () => {
    routeApi([], []);

    renderPage();

    // Assert on what the empty branch actually renders. Checking only that
    // 'A-101' is absent would pass just as happily if the page rendered
    // nothing at all, which is the failure this test exists to catch.
    expect(await screen.findByText('No sheets indexed yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a multi-page PDF drawing set to the Files module/),
    ).toBeInTheDocument();
    // The "nothing indexed" copy, not the "your filter matched nothing" copy -
    // they are different branches and telling a user to adjust a filter they
    // never set would send them looking for a control that changes nothing.
    expect(screen.queryByText('No matching sheets')).not.toBeInTheDocument();
  });
});
