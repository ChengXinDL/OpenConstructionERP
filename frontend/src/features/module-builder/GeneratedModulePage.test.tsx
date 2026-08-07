// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The generic screen, driven by a specification it has never seen before.
 *
 * The point of these is that nothing about the module under test is compiled
 * in. The spec below is invented here, and the assertions are about the screen
 * having read it: the columns it drew, the inputs it chose, the field a refusal
 * landed on. A renderer that quietly ignored half the spec would still show a
 * table, so each test names something specific the spec asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ moduleKey: 'pour_register' }) };
});

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    fetchInstalledModules: vi.fn(),
    fetchModuleUiSpec: vi.fn(),
    fetchModuleRecords: vi.fn(),
    createModuleRecord: vi.fn(),
    updateModuleRecord: vi.fn(),
    deleteModuleRecord: vi.fn(),
  };
});

import { ApiError } from '@/shared/lib/api';
import { useProjectContextStore } from '@/stores/useProjectContextStore';

import {
  createModuleRecord,
  deleteModuleRecord,
  fetchInstalledModules,
  fetchModuleRecords,
  fetchModuleUiSpec,
  updateModuleRecord,
  type GeneratedRecord,
  type InstalledList,
  type ModuleUiSpec,
} from './api';
import { GeneratedModulePage } from './GeneratedModulePage';

const installed = vi.mocked(fetchInstalledModules);
const uiSpec = vi.mocked(fetchModuleUiSpec);
const records = vi.mocked(fetchModuleRecords);
const create = vi.mocked(createModuleRecord);
const update = vi.mocked(updateModuleRecord);
const remove = vi.mocked(deleteModuleRecord);

const BASE_PATH = '/api/v1/pour-register';

const INSTALLED: InstalledList = {
  items: [
    {
      key: 'pour_register',
      module_name: 'oe_pour_register',
      display_name: 'Pour Register',
      version: '0.1.0',
      generated_at: '2026-08-07T00:00:00Z',
      entity: 'Pour',
      field_count: 5,
      rule_count: 2,
      base_path: BASE_PATH,
    },
  ],
  total: 1,
  runtime_root: '/home/oe/.openestimate/modules',
};

const SPEC: ModuleUiSpec = {
  key: 'pour_register',
  display_name: 'Pour Register',
  description: 'Every pour, what went in it and who signed it off.',
  category: 'community',
  icon: 'Boxes',
  version: '0.1.0',
  author: '',
  entity: {
    name: 'pour',
    display_name: 'Pour',
    plural_name: 'Pours',
    project_scoped: true,
    fields: [
      { name: 'reference', label: 'Pour reference', type: 'text', required: true, help_text: '', unit: '', options: [], in_list: true },
      { name: 'volume', label: 'Volume', type: 'number', required: false, help_text: 'As delivered', unit: 'm3', options: [], in_list: true },
      { name: 'cost', label: 'Cost', type: 'money', required: false, help_text: '', unit: '', options: [], in_list: true },
      { name: 'poured_on', label: 'Poured on', type: 'date', required: false, help_text: '', unit: '', options: [], in_list: true },
      { name: 'mix', label: 'Mix', type: 'select', required: false, help_text: '', unit: '', options: ['C25/30', 'C32/40'], in_list: true },
      { name: 'signed_off', label: 'Signed off', type: 'boolean', required: false, help_text: '', unit: '', options: [], in_list: true },
      { name: 'notes', label: 'Notes', type: 'long_text', required: false, help_text: '', unit: '', options: [], in_list: false },
    ],
  },
  rules: [
    { code: 'REFERENCE_REQUIRED', message: 'A pour without a reference cannot be traced.', kind: 'required', field: 'reference', min_value: null, max_value: null, other_field: '', severity: 'error' },
    { code: 'VOLUME_POSITIVE', message: 'A pour of nothing is not a pour.', kind: 'positive', field: 'volume', min_value: null, max_value: null, other_field: '', severity: 'error' },
  ],
};

const ROW: GeneratedRecord = {
  id: 'rec-1',
  project_id: 'p1',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  reference: 'P-014',
  volume: '18.50',
  cost: '4210.00',
  poured_on: '2026-08-01',
  mix: 'C25/30',
  signed_off: true,
  notes: 'Slab B.',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GeneratedModulePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectContextStore.setState({ activeProjectId: 'p1', activeProjectName: 'Site A' });
  installed.mockResolvedValue(INSTALLED);
  uiSpec.mockResolvedValue(SPEC);
  records.mockResolvedValue({ items: [ROW], total: 1 });
  create.mockResolvedValue(ROW);
  update.mockResolvedValue(ROW);
  remove.mockResolvedValue(undefined);
});

describe('reading a module it has never seen', () => {
  it('asks the server where the module lives instead of guessing', async () => {
    renderPage();
    await waitFor(() => expect(uiSpec).toHaveBeenCalledWith(BASE_PATH));
    // The route carries `pour_register`; the URL is `pour-register`. Nothing
    // here turned one into the other - the installed list did.
    expect(records).toHaveBeenCalledWith(BASE_PATH, { projectId: 'p1', limit: 200 });
  });

  it('draws the columns the spec marked, and not the ones it did not', async () => {
    renderPage();
    const table = await screen.findByTestId('runtime-module-table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers.some((h) => h.includes('Pour reference'))).toBe(true);
    expect(headers.some((h) => h.includes('Volume'))).toBe(true);
    // `notes` is in_list: false, so it belongs on the record and not in the table.
    expect(headers.some((h) => h.includes('Notes'))).toBe(false);
  });

  it('names the unit in the column heading rather than on every row', async () => {
    renderPage();
    const table = await screen.findByTestId('runtime-module-table');
    expect(within(table).getByText(/\(m3\)/)).toBeTruthy();
  });

  it('renders a checkbox column as a word, not as true', async () => {
    renderPage();
    const table = await screen.findByTestId('runtime-module-table');
    expect(within(table).queryByText('true')).toBeNull();
    expect(within(table).getByText('Yes')).toBeTruthy();
  });

  it('shows the module own rules on the screen it built', async () => {
    renderPage();
    expect(await screen.findByText('A pour of nothing is not a pour.')).toBeTruthy();
  });

  it('says so when the instance carries no such module', async () => {
    installed.mockResolvedValue({ items: [], total: 0, runtime_root: '/tmp' });
    renderPage();
    expect(await screen.findByText(/No such module on this instance/i)).toBeTruthy();
    // And it does not go on to ask a module that is not there for its spec.
    expect(uiSpec).not.toHaveBeenCalled();
  });

  it('offers to record the first one when there is nothing yet', async () => {
    records.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByText(/No Pours yet/i)).toBeTruthy();
  });
});

describe('the project a record belongs to', () => {
  it('will not let a scoped record be started without a project', async () => {
    useProjectContextStore.setState({ activeProjectId: null });
    renderPage();
    await screen.findByTestId('runtime-module-page');
    expect(screen.getByTestId('runtime-module-new')).toBeDisabled();
    // Asking for the records would 422 on the missing project, so it does not.
    expect(records).not.toHaveBeenCalled();
  });

  it('does not demand one from a module whose records are not scoped', async () => {
    useProjectContextStore.setState({ activeProjectId: null });
    uiSpec.mockResolvedValue({ ...SPEC, entity: { ...SPEC.entity, project_scoped: false } });
    renderPage();
    await screen.findByTestId('runtime-module-table');
    expect(records).toHaveBeenCalledWith(BASE_PATH, { projectId: null, limit: 200 });
    expect(screen.getByTestId('runtime-module-new')).not.toBeDisabled();
  });
});

describe('recording one', () => {
  it('builds a form from the spec, one input per field', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('runtime-module-table');
    await user.click(screen.getByTestId('runtime-module-new'));

    // A select is a select, a checkbox is a checkbox, a date is a date. A
    // renderer that put everything in a text box would still "work".
    expect(await screen.findByLabelText(/Mix/)).toHaveProperty('tagName', 'SELECT');
    expect(screen.getByLabelText(/Signed off/)).toHaveProperty('type', 'checkbox');
    expect(screen.getByLabelText(/Poured on/)).toHaveProperty('type', 'date');
    expect(screen.getByLabelText(/Notes/).tagName).toBe('TEXTAREA');
  });

  it('sends money as the string that was typed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('runtime-module-table');
    await user.click(screen.getByTestId('runtime-module-new'));
    await screen.findByLabelText(/Pour reference/);

    await user.type(screen.getByLabelText(/Pour reference/), 'P-015');
    await user.type(screen.getByLabelText(/Volume/), '12.5');
    await user.type(screen.getByLabelText(/^Cost/), '1234.05');
    await user.click(screen.getByTestId('runtime-module-save'));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const [path, payload] = create.mock.calls[0] ?? [];
    expect(path).toBe(BASE_PATH);
    expect(payload).toMatchObject({ project_id: 'p1', reference: 'P-015', cost: '1234.05', volume: '12.5' });
    expect(typeof (payload as Record<string, unknown>).cost).toBe('string');
  });

  it('answers a rule before the round trip rather than after it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('runtime-module-table');
    await user.click(screen.getByTestId('runtime-module-new'));
    await screen.findByLabelText(/Pour reference/);

    // The reference is required and empty, and the volume breaks a rule.
    await user.type(screen.getByLabelText(/Volume/), '0');
    await user.click(screen.getByTestId('runtime-module-save'));

    // Scoped to the form: the same sentence is also on the page, in the panel
    // that lists what this module checks, and that one was there all along.
    const form = screen.getByRole('dialog');
    expect(await within(form).findByText('A pour of nothing is not a pour.')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('puts a refusal from the server on the field it is about', async () => {
    create.mockRejectedValue(
      new ApiError(422, 'Unprocessable Entity', {
        detail: [{ code: 'VOLUME_POSITIVE', message: 'The batching plant reported nothing.', field: 'volume' }],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('runtime-module-table');
    await user.click(screen.getByTestId('runtime-module-new'));
    await screen.findByLabelText(/Pour reference/);

    await user.type(screen.getByLabelText(/Pour reference/), 'P-016');
    await user.click(screen.getByTestId('runtime-module-save'));

    expect(await screen.findByText('The batching plant reported nothing.')).toBeTruthy();
  });
});

describe('correcting one', () => {
  it('opens the row that was clicked, not a blank form', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByTestId('runtime-module-table');
    await user.click(within(table).getByLabelText('Edit'));

    const reference = await screen.findByLabelText(/Pour reference/);
    expect(reference).toHaveProperty('value', 'P-014');
    expect(screen.getByLabelText(/^Cost/)).toHaveProperty('value', '4210.00');
  });

  it('sends only what changed', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByTestId('runtime-module-table');
    await user.click(within(table).getByLabelText('Edit'));
    await screen.findByLabelText(/Pour reference/);

    await user.clear(screen.getByLabelText(/Volume/));
    await user.type(screen.getByLabelText(/Volume/), '19');
    await user.click(screen.getByTestId('runtime-module-save'));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[2]).toEqual({ volume: '19' });
  });
});

describe('removing one', () => {
  it('asks before it does, and then does', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByTestId('runtime-module-table');
    await user.click(within(table).getByLabelText('Delete'));

    expect(await screen.findByText(/cannot be undone/i)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(BASE_PATH, 'rec-1'));
  });
});
