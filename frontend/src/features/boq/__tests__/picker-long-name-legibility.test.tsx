// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Issue #406 — regression guard for the two pickers that render a catalogue
// name on one truncated line.
//
// Structured catalogues (NPK, STLB/GAEB, BC3) build a position text as a long
// shared prefix plus a short discriminating tail. `truncate` clips exactly the
// tail, so five different assemblies painted as five identical rows and the
// estimator could not tell which one he was selecting.
//
// What these tests can and cannot prove: JSDOM does not lay text out, so there
// is no way to assert from here that the tail is on screen. They assert the
// class contract instead — the clipped-to-one-line utility is gone, the
// two-line clamp is in place, and the full string is carried on `title`. That
// is a regression guard against someone reinstating `truncate`, not evidence of
// legibility. Confirming that the tail is actually readable, and that the code
// chip sits on the name's first line, needs a real browser.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Hoisted mocks — must precede the component imports so the dynamic
// `import('@/stores/useCostDatabaseStore')` inside AutocompleteInput resolves
// to the stub.
vi.mock('@/stores/useCostDatabaseStore', async () => {
  const actual = await vi.importActual<
    typeof import('@/stores/useCostDatabaseStore')
  >('@/stores/useCostDatabaseStore');
  return {
    ...actual,
    useCostDatabaseStore: { getState: () => ({ activeRegion: undefined }) },
  };
});

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    boqApi: { ...actual.boqApi, autocomplete: vi.fn() },
  };
});

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({})),
  triggerDownload: vi.fn(),
}));

import { AutocompleteInput } from '../AutocompleteInput';
import { AssemblyPickerModal } from '../BOQModals';
import { boqApi } from '../api';
import { apiGet } from '@/shared/lib/api';

// Five entries whose first three words are identical — the reporter's case.
const PREFIX = 'Installation de chantier';

const SUGGESTIONS = [
  {
    code: 'NPK-113-001',
    description: `${PREFIX} pour ouvrage de petite taille, acces libre, sans grue`,
    unit: 'pce',
    rate: 4200,
    currency: 'CHF',
    region: 'CH_ZURICH',
    classification: {},
    components: [],
    cost_breakdown: undefined,
    metadata_: undefined,
  },
  {
    code: 'NPK-113-002',
    description: `${PREFIX} pour ouvrage de grande taille, acces restreint, avec grue`,
    unit: 'pce',
    rate: 18600,
    currency: 'CHF',
    region: 'CH_ZURICH',
    classification: {},
    components: [],
    cost_breakdown: undefined,
    metadata_: undefined,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('hover: hover'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  (boqApi.autocomplete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    SUGGESTIONS,
  );
});

/* -- Cost item autocomplete ------------------------------------------------ */

describe('AutocompleteInput - long catalogue descriptions (#406)', () => {
  async function openDropdown() {
    render(
      <AutocompleteInput
        value=""
        onCommit={vi.fn()}
        onSelectSuggestion={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'installation' },
    });
    await waitFor(() => expect(boqApi.autocomplete).toHaveBeenCalled());
    return screen.findAllByTestId('autocomplete-suggestion');
  }

  it('clamps the description to two lines instead of one clipped line', async () => {
    const rows = await openDropdown();

    for (const row of rows) {
      const desc = row.querySelector('p');
      expect(desc).not.toBeNull();
      expect(desc).toHaveClass('line-clamp-2');
      // The single-line clip is what erased the discriminating tail.
      expect(desc).not.toHaveClass('truncate');
    }
  });

  it('carries the untruncated description on title for each suggestion', async () => {
    const rows = await openDropdown();

    const titles = rows.map((r) => r.querySelector('p')?.getAttribute('title'));
    expect(titles).toEqual(SUGGESTIONS.map((s) => s.description));
    // Sanity: the fixtures really are indistinguishable on their prefix, so a
    // test that passed on the prefix alone would be proving nothing.
    expect(new Set(titles.map((d) => d?.slice(0, PREFIX.length))).size).toBe(1);
  });
});

/* -- Assembly picker ------------------------------------------------------- */

// Named rather than indexed off the array: `noUncheckedIndexedAccess` is on,
// so ASSEMBLIES[0] would be `… | undefined` at every use site.
const ASM_SMALL = {
  id: 'asm-1',
  code: 'A-001',
  name: `${PREFIX} pour ouvrage de petite taille, sans grue`,
  unit: 'pce',
  category: 'Preliminaries',
  total_rate: 4200,
  currency: 'CHF',
  components: [],
};

const ASM_LARGE = {
  id: 'asm-2',
  code: 'A-002',
  name: `${PREFIX} pour ouvrage de grande taille, avec grue`,
  unit: 'pce',
  category: 'Preliminaries',
  total_rate: 18600,
  currency: 'CHF',
  components: [],
};

const ASSEMBLIES = [ASM_SMALL, ASM_LARGE];

describe('AssemblyPickerModal - long recipe names (#406)', () => {
  function renderModal() {
    (apiGet as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: ASSEMBLIES,
      total: ASSEMBLIES.length,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AssemblyPickerModal
            boqId="boq-1"
            onClose={vi.fn()}
            onApplied={vi.fn()}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('clamps the recipe name to two lines and keeps the full text on title', async () => {
    renderModal();

    for (const asm of ASSEMBLIES) {
      const name = await screen.findByText(asm.name);
      expect(name).toHaveClass('line-clamp-2');
      expect(name).not.toHaveClass('truncate');
      expect(name).toHaveAttribute('title', asm.name);
    }
  });

  it('keeps the code beside the name without letting it shrink', async () => {
    renderModal();

    const name = await screen.findByText(ASM_SMALL.name);
    const row = name.parentElement;
    expect(row).not.toBeNull();
    // A two-line clamp under `items-center` would centre the name against the
    // code; baseline alignment pins the code to the name's first line.
    expect(row).toHaveClass('items-baseline');
    expect(screen.getByText('A-001')).toHaveClass('shrink-0');
  });
});
