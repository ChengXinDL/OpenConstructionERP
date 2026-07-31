// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Resolve a project id from the context store without a real store.
vi.mock('@/stores/useProjectContextStore', () => ({
  useProjectContextStore: (sel: (s: { activeProjectId: string }) => unknown) => sel({ activeProjectId: 'p-1' }),
}));

// Every client function the page calls has to be stubbed by name. Spreading the
// real module and stubbing only some of them would leave the rest running for
// real against the mocked `apiGet` below, which resolves to undefined.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    searchRecords: vi.fn(),
    listSavedSearches: vi.fn(),
    createSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
    recordSavedSearchUse: vi.fn(),
  };
});

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  getErrorMessage: (e: unknown) => String(e),
}));

import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  recordSavedSearchUse,
  searchRecords,
} from '../api';
import { RetrievalPage } from '../RetrievalPage';
import type { SavedSearch } from '../types';

/** One pinned search, shaped as the server sends it. */
function savedSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'ss-1',
    project_id: 'p-1',
    label: 'Rebar claims',
    query: {
      text: 'rebar',
      party: '',
      record_type: '',
      date_from: '',
      date_to: '',
      entity: '',
    },
    signature: 'sig-1',
    use_count: 2,
    last_used_at: '2026-06-21T00:00:00Z',
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-21T00:00:00Z',
    validation_status: 'passed',
    validation_findings: [],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/find']}>
        <RetrievalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Recent searches are localStorage-backed (pinned ones live on the server);
  // clear the store so history from one test never leaks into the next.
  localStorage.clear();
  vi.mocked(listSavedSearches).mockResolvedValue({ count: 0, results: [] });
  vi.mocked(createSavedSearch).mockResolvedValue(savedSearch());
  vi.mocked(deleteSavedSearch).mockResolvedValue(undefined);
  vi.mocked(recordSavedSearchUse).mockResolvedValue(savedSearch());
  vi.mocked(searchRecords).mockResolvedValue({
    count: 1,
    results: [
      {
        record_type: 'change_order',
        record_id: 'co-7',
        title: 'Additional rebar to core wall',
        snippet: 'Add rebar to the core wall.',
        source_module: 'changeorders',
        party: 'contractor-a',
        occurred_at: '2026-06-20T00:00:00Z',
        entity_refs: ['CO-7'],
        score: 0.83,
        matched_facets: ['text'],
        provenance: { module: 'changeorders', record_id: 'co-7' },
      },
    ],
  });
});

describe('RetrievalPage', () => {
  it('renders the search box and a starter empty state before any search', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Find Records/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search the project record/i)).toBeInTheDocument();
    // No search has been committed yet, so the starter prompt shows.
    expect(screen.getByText(/Enter a term or open Filters/i)).toBeInTheDocument();
    expect(searchRecords).not.toHaveBeenCalled();
  });

  it('runs a search and renders ranked results with provenance facets', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Search the project record/i), {
      target: { value: 'rebar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));

    // The title is a deep-link to the owning module, and the query term is
    // highlighted inside it (so the text is split by a <mark>); assert on the
    // link's accessible name, which concatenates the whole title.
    const titleLink = await screen.findByRole('link', {
      name: 'Additional rebar to core wall',
    });
    expect(titleLink).toHaveAttribute('href', '/changeorders');
    expect(searchRecords).toHaveBeenCalledWith('p-1', expect.objectContaining({ text: 'rebar' }));
    // The snippet is likewise split by the highlight mark, so match on the
    // paragraph's full text content.
    expect(
      screen.getByText(
        (_content, el) =>
          el?.tagName === 'P' && el?.textContent === 'Add rebar to the core wall.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('CO-7')).toBeInTheDocument();
    expect(screen.getByText(/1 results/i)).toBeInTheDocument();
  });

  it('pins the committed search on the server rather than in the browser', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Search the project record/i), {
      target: { value: 'rebar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));

    fireEvent.click(await screen.findByRole('button', { name: /Save this search/i }));

    await waitFor(() => {
      expect(createSavedSearch).toHaveBeenCalledWith(
        'p-1',
        'rebar',
        expect.objectContaining({ text: 'rebar' }),
      );
    });
    // The pin is the server's now: nothing about it is written locally.
    expect(localStorage.getItem('oce.retrieval.saved')).toBeNull();
  });

  it('replays a pin the server sent back and records the use', async () => {
    vi.mocked(listSavedSearches).mockResolvedValue({ count: 1, results: [savedSearch()] });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Rebar claims' }));

    await waitFor(() => {
      expect(recordSavedSearchUse).toHaveBeenCalledWith('ss-1');
    });
    expect(searchRecords).toHaveBeenCalledWith('p-1', expect.objectContaining({ text: 'rebar' }));
  });

  it('unpins through the API instead of dropping a local entry', async () => {
    vi.mocked(listSavedSearches).mockResolvedValue({ count: 1, results: [savedSearch()] });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Remove saved search/i }));

    await waitFor(() => {
      expect(deleteSavedSearch).toHaveBeenCalledWith('ss-1');
    });
  });
});
