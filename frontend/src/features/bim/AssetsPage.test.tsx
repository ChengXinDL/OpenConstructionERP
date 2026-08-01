// @ts-nocheck
/**
 * Smoke tests for the Asset Register page.
 *
 * Renders the page with a mocked API layer so we can verify:
 *   - empty state when no project is active
 *   - table population when assets are returned
 *   - search param round-trip
 *   - edit modal patches the correct element
 *
 * Network is stubbed via ``vi.mock`` on ``./api``. React Query is wired
 * with retry disabled so errors surface immediately instead of being
 * swallowed by default retry logic.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useProjectContextStore } from '@/stores/useProjectContextStore';

// src/test/setup.ts stubs useSearchParams globally to an always-empty
// URLSearchParams with a no-op setter, so no URL state reaches a component
// under test. This page keeps its filters in the URL, so that stub would make
// every filter test pass for the wrong reason: nothing filtered, nothing
// asserted. Restore the real hook here and let MemoryRouter drive it.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({}) };
});

vi.mock('./api', () => ({
  listTrackedAssets: vi.fn(),
  updateElementAssetInfo: vi.fn(),
  cobieExportUrl: (modelId: string) => `/api/v1/bim_hub/models/${modelId}/export/cobie.xlsx/`,
  // Needed by AssetDetailDrawer: vi.mock replaces the whole module, so a
  // function left out here is undefined at call time rather than stubbed.
  fetchBIMElementsByIds: vi.fn(() => Promise.resolve({ items: [] })),
  fetchBIMElementProperties: vi.fn(() => Promise.resolve({ properties: {} })),
  downloadCobieXlsx: vi.fn(() => Promise.resolve()),
}));

// The Asset Operations pieces composed onto this page talk to a different
// module (/v1/assets), so they need their own stub. Without it the portfolio
// call just fails and the strip renders null, which would let a "the strip is
// mounted" assertion pass for the wrong reason.
vi.mock('@/features/assets/api', () => ({
  fetchPortfolio: vi.fn(),
  listAssets: vi.fn(),
  discoverAssets: vi.fn(),
  scanWarrantyAlerts: vi.fn(),
  appendServiceLog: vi.fn(),
}));

import { listTrackedAssets, updateElementAssetInfo } from './api';
import { fetchPortfolio, listAssets } from '@/features/assets/api';
import { AssetsPage } from './AssetsPage';

const sampleAsset = {
  id: 'elem-1',
  stable_id: 'AHU-01',
  element_type: 'AirHandlingUnit',
  name: 'AHU Rooftop',
  model_id: 'model-1',
  model_name: 'Mechanical.rvt',
  project_id: 'proj-1',
  asset_info: {
    manufacturer: 'Siemens',
    model: 'SV-100',
    serial_number: 'SN-123',
    operational_status: 'operational',
    warranty_until: '2028-01-01',
  },
};

function renderWithProviders() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/assets']}>
        <AssetsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AssetsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectContextStore.getState().clearProject();
  });

  it('shows the "no project" empty state when none is active', () => {
    renderWithProviders();
    expect(screen.getByText(/No active project/i)).toBeInTheDocument();
    expect(listTrackedAssets).not.toHaveBeenCalled();
  });

  it('renders a table of tracked assets for the active project', async () => {
    useProjectContextStore.getState().setActiveProject('proj-1', 'Riverside HQ');
    (listTrackedAssets as any).mockResolvedValue({ items: [sampleAsset], total: 1 });

    renderWithProviders();

    await waitFor(() => expect(listTrackedAssets).toHaveBeenCalledWith('proj-1', expect.any(Object)));
    expect(await screen.findByText('Siemens')).toBeInTheDocument();
    expect(screen.getByText('SV-100')).toBeInTheDocument();
    expect(screen.getByText('SN-123')).toBeInTheDocument();
    expect(screen.getByText(/AHU Rooftop/)).toBeInTheDocument();
  });

  it('renders an empty state when the project has no tracked assets', async () => {
    useProjectContextStore.getState().setActiveProject('proj-1', 'Riverside HQ');
    (listTrackedAssets as any).mockResolvedValue({ items: [], total: 0 });
    renderWithProviders();
    expect(await screen.findByText(/No tracked assets yet/i)).toBeInTheDocument();
  });

  it('opens the edit modal and patches asset info via the API', async () => {
    useProjectContextStore.getState().setActiveProject('proj-1', 'Riverside HQ');
    (listTrackedAssets as any).mockResolvedValue({ items: [sampleAsset], total: 1 });
    (updateElementAssetInfo as any).mockResolvedValue(sampleAsset);

    renderWithProviders();

    const editButton = await screen.findByTestId(`asset-edit-${sampleAsset.id}`);
    fireEvent.click(editButton);

    const modal = await screen.findByTestId('asset-edit-modal');
    expect(modal).toBeInTheDocument();

    // Update manufacturer and save.
    const input = screen.getByTestId('asset-field-manufacturer') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Grundfos' } });

    fireEvent.click(screen.getByTestId('asset-save'));

    await waitFor(() => expect(updateElementAssetInfo).toHaveBeenCalled());
    const [elementId, payload] = (updateElementAssetInfo as any).mock.calls[0];
    expect(elementId).toBe(sampleAsset.id);
    expect(payload.manufacturer).toBe('Grundfos');
    // Fields that were unchanged but populated must survive the round-trip.
    expect(payload.model).toBe('SV-100');
    // Fields the user didn't interact with that were never in asset_info
    // stay absent from the payload — no accidental clears.
    expect(payload).not.toHaveProperty('notes');
  });
});

/**
 * Asset Operations composition.
 *
 * These five components shipped complete but were mounted nowhere, so the
 * register never showed a portfolio roll-up, never offered discovery and
 * never scanned warranties. What is worth testing is the wiring, not the
 * components' internals, so each test here fails if the mount is removed
 * from AssetsPage.tsx - verified by deleting each mount in turn.
 */
const samplePortfolio = {
  total_assets: 12,
  by_operational_status: {},
  by_warranty_status: {},
  by_maintenance_status: {},
  warranties_expiring_soon: 3,
  warranties_expired: 2,
  maintenance_due: 4,
  maintenance_overdue: 1,
  needs_attention: 5,
  models_covered: 2,
  avg_age_years: 3.5,
  top_attention: [],
};

describe('AssetsPage — Asset Operations composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectContextStore.getState().clearProject();
    useProjectContextStore.getState().setActiveProject('proj-1', 'Riverside HQ');
    (listTrackedAssets as any).mockResolvedValue({ items: [sampleAsset], total: 1 });
  });

  it('shows the portfolio roll-up with counts from the assets endpoint', async () => {
    (fetchPortfolio as any).mockResolvedValue(samplePortfolio);

    renderWithProviders();

    // Scoped to the strip: the register table also renders numbers, and a
    // bare getByText('12') could match one of those instead.
    const strip = await screen.findByTestId('asset-portfolio-strip');
    expect(strip).toBeInTheDocument();
    expect(await screen.findByTestId('asset-kpi-total')).toHaveTextContent('12');
    expect(screen.getByTestId('asset-kpi-warranty-expired')).toHaveTextContent('2');
    expect(screen.getByTestId('asset-kpi-maint-overdue')).toHaveTextContent('1');
    expect(fetchPortfolio).toHaveBeenCalledWith('proj-1');
  });

  it('keeps the roll-up hidden until the project actually has tracked assets', async () => {
    // Its own documented behaviour, asserted here because the page mounts it
    // unconditionally and relies on that guard to stay quiet on a new project.
    (fetchPortfolio as any).mockResolvedValue({ ...samplePortfolio, total_assets: 0 });

    renderWithProviders();

    await waitFor(() => expect(fetchPortfolio).toHaveBeenCalled());
    expect(screen.queryByTestId('asset-portfolio-strip')).not.toBeInTheDocument();
  });

  it('offers discovery and warranty scanning above the register', async () => {
    (fetchPortfolio as any).mockResolvedValue(samplePortfolio);

    renderWithProviders();

    expect(await screen.findByTestId('asset-ops-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('discover-assets-open')).toBeInTheDocument();
  });

  it('opens the discovery modal from the toolbar', async () => {
    (fetchPortfolio as any).mockResolvedValue(samplePortfolio);

    renderWithProviders();

    fireEvent.click(await screen.findByTestId('discover-assets-open'));

    // Proves the toolbar is wired to a real modal rather than being a
    // decorative button row.
    expect(await screen.findByTestId('discover-assets-modal')).toBeInTheDocument();
  });

  it('shows the service log, with its existing history, in the detail drawer', async () => {
    (fetchPortfolio as any).mockResolvedValue(samplePortfolio);
    const serviced = {
      ...sampleAsset,
      asset_info: {
        ...sampleAsset.asset_info,
        // Stored as a JSON array, which AssetInfoPayload's index signature
        // types as a string. Asserting on a rendered entry is what proves
        // the narrowing in AssetDetailDrawer kept the real history instead
        // of silently falling back to an empty list.
        service_log: [{ date: '2026-03-04', note: 'Replaced filter belt', kind: 'service' }],
      },
    };
    (listTrackedAssets as any).mockResolvedValue({ items: [serviced], total: 1 });

    renderWithProviders();

    fireEvent.click(await screen.findByTestId(`asset-row-${serviced.id}`));

    expect(await screen.findByTestId('service-log-panel')).toBeInTheDocument();
    expect(await screen.findByText(/Replaced filter belt/)).toBeInTheDocument();
  });
});

/**
 * Where the register gets its rows.
 *
 * The page now lists through Asset Operations, which owns the warranty and
 * maintenance filters the KPI tiles need, and falls back to the BIM Hub when
 * that module is off or the caller lacks `assets.read`. Both paths matter:
 * the fallback is the one that keeps the page working for people who have it
 * today, and a fallback only ever exercised by a forced exception is the
 * branch that turns out to be wrong when it finally runs.
 */
const sampleOpsRow = {
  id: 'elem-9',
  model_id: 'model-1',
  project_id: 'proj-1',
  model_name: 'Mechanical.rvt',
  stable_id: 'PMP-09',
  element_type: 'Pump',
  name: 'Basement Pump',
  storey: null,
  manufacturer: 'Grundfos',
  model: 'CR-5',
  serial_number: 'SN-909',
  operational_status: 'operational',
  parent_system: null,
  asset_info: {
    manufacturer: 'Grundfos',
    model: 'CR-5',
    serial_number: 'SN-909',
    operational_status: 'operational',
  },
  health: { warranty_status: 'expired', maintenance_status: 'ok', attention_score: 40, issues: [] },
};

function renderAt(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AssetsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AssetsPage register source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectContextStore.getState().clearProject();
    useProjectContextStore.getState().setActiveProject('proj-1', 'Riverside HQ');
    (fetchPortfolio as any).mockResolvedValue(samplePortfolio);
  });

  it('lists through Asset Operations when the module answers', async () => {
    (listAssets as any).mockResolvedValue({ items: [sampleOpsRow], total: 1, offset: 0, limit: 500 });

    renderAt('/assets');

    expect(await screen.findByText('Grundfos')).toBeInTheDocument();
    expect(screen.getByText('SN-909')).toBeInTheDocument();
    // The BIM Hub is the fallback, so it must not be consulted on the happy
    // path - otherwise every request would cost two round trips.
    expect(listTrackedAssets).not.toHaveBeenCalled();
  });

  it('asks for enough rows that the switch does not shrink the register', async () => {
    (listAssets as any).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 500 });

    renderAt('/assets');

    // The endpoint's own default is 50, well under the 200 this page showed
    // before, so an absent limit would quietly drop rows.
    await waitFor(() =>
      expect(listAssets).toHaveBeenCalledWith('proj-1', expect.objectContaining({ limit: 500 })),
    );
  });

  it('falls back to the BIM Hub when Asset Operations is unavailable', async () => {
    (listAssets as any).mockRejectedValue(new Error('module disabled'));
    (listTrackedAssets as any).mockResolvedValue({ items: [sampleAsset], total: 1 });

    renderAt('/assets');

    // Same page, same rows: someone without the module keeps the register.
    expect(await screen.findByText('Siemens')).toBeInTheDocument();
    await waitFor(() => expect(listTrackedAssets).toHaveBeenCalled());
  });

  it('refuses to fall back when a tile filter is set, rather than listing unfiltered rows', async () => {
    (listAssets as any).mockRejectedValue(new Error('module disabled'));
    (listTrackedAssets as any).mockResolvedValue({ items: [sampleAsset], total: 1 });

    renderAt('/assets?attention=1');

    // The BIM Hub cannot filter by attention. Answering from it would show
    // every asset under a heading that says these need attention, which is
    // worse than an error because nothing on screen would look wrong.
    expect(await screen.findByText(/Could not load assets/i)).toBeInTheDocument();
    expect(listTrackedAssets).not.toHaveBeenCalled();
  });

  it('sends the attention filter to the endpoint that computes the count', async () => {
    (listAssets as any).mockResolvedValue({ items: [sampleOpsRow], total: 1, offset: 0, limit: 500 });

    renderAt('/assets?attention=1');

    await waitFor(() =>
      expect(listAssets).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ needsAttention: true }),
      ),
    );
  });

  it('offers a way back to the full register once a tile filter is set', async () => {
    (listAssets as any).mockResolvedValue({ items: [sampleOpsRow], total: 1, offset: 0, limit: 500 });

    renderAt('/assets?warranty=expired');

    // Without this control the only way out of a tile filter is editing the
    // URL, so the chip is the feature, not decoration.
    const clear = await screen.findByTestId('asset-kpi-filter-clear');
    expect(clear).toHaveTextContent(/Warranty expired/i);

    fireEvent.click(clear);

    await waitFor(() => {
      const last = (listAssets as any).mock.calls.at(-1);
      expect(last[1].warrantyStatus).toBeUndefined();
    });
  });
});
