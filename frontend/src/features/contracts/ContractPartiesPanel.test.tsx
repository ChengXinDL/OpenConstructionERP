// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Component tests for <ContractPartiesPanel>.
//
// The register is what the signature block is derived from, so the two things
// worth pinning here are the ones that are wrong in a way a healthy screen
// does not show:
//
//   * a register holding only a consultant is full, and signs nothing. The
//     panel has to say so, because the next thing the user does is press a
//     button that will be refused and they will not know why.
//   * a party is deleted by its own id. Every other call in this feature is
//     addressed through the contract, so passing the contract id here is the
//     natural mistake and it would delete somebody else's row or nothing.
//
// The api module is stubbed whole, which means the role vocabularies it
// exports have to be stubbed with it: they are values, not types, and the
// panel reads them at render time.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('./api', () => ({
  listContractParties: vi.fn(),
  createContractParty: vi.fn(),
  deleteContractParty: vi.fn(),
  CONTRACT_PARTY_ROLES: [
    'employer',
    'contractor',
    'subcontractor',
    'consultant',
    'architect',
    'engineer',
    'guarantor',
    'other',
  ] as const,
  SIGNING_PARTY_ROLES: ['employer', 'contractor', 'subcontractor'] as const,
}));

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) =>
    sel({ addToast: vi.fn() }),
}));

import { ContractPartiesPanel } from './ContractPartiesPanel';
import * as api from './api';
import type { ContractParty } from './api';

const listMock = vi.mocked(api.listContractParties);
const createMock = vi.mocked(api.createContractParty);
const deleteMock = vi.mocked(api.deleteContractParty);

const CONTRACT_ID = 'c-1';

function party(over: Partial<ContractParty> = {}): ContractParty {
  return {
    id: 'p-1',
    contract_id: CONTRACT_ID,
    party_role: 'employer',
    party_type: 'external',
    party_id: null,
    display_name: 'Northlake Estates',
    resolved_name: null,
    is_primary: true,
    contact_details: {},
    metadata: {},
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...over,
  };
}

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ContractPartiesPanel contractId={CONTRACT_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  createMock.mockResolvedValue(party());
  deleteMock.mockResolvedValue(undefined);
});

describe('<ContractPartiesPanel>', () => {
  it('lists each party with its role', async () => {
    listMock.mockResolvedValue([
      party(),
      party({
        id: 'p-2',
        party_role: 'contractor',
        display_name: 'Bramwell Civil Works',
        is_primary: false,
      }),
    ]);
    renderPanel();

    expect(await screen.findByText('Northlake Estates')).toBeInTheDocument();
    expect(screen.getByText('Bramwell Civil Works')).toBeInTheDocument();
    expect(screen.getByText('Employer')).toBeInTheDocument();
    expect(screen.getByText('Contractor')).toBeInTheDocument();
  });

  it('prefers the resolved name over the copy taken when the row was written', async () => {
    listMock.mockResolvedValue([
      party({ display_name: 'Old Trading Name', resolved_name: 'Renamed Holdings' }),
    ]);
    renderPanel();

    expect(await screen.findByText('Renamed Holdings')).toBeInTheDocument();
    expect(screen.queryByText('Old Trading Name')).not.toBeInTheDocument();
  });

  it('says a register of non-signing roles signs nothing', async () => {
    listMock.mockResolvedValue([
      party({ party_role: 'consultant', display_name: 'Harlow Cost Advisors' }),
      party({ id: 'p-2', party_role: 'architect', display_name: 'Vance Studio' }),
    ]);
    renderPanel();

    expect(await screen.findByText(/None of these roles sign/i)).toBeInTheDocument();
    expect(screen.queryByText(/are the ones asked to sign/i)).not.toBeInTheDocument();
  });

  it('names who signs once a signing role is on the register', async () => {
    listMock.mockResolvedValue([party(), party({ id: 'p-2', party_role: 'consultant' })]);
    renderPanel();

    expect(await screen.findByText(/are the ones asked to sign/i)).toBeInTheDocument();
    expect(screen.queryByText(/None of these roles sign/i)).not.toBeInTheDocument();
  });

  it('says neither thing while the register is empty', async () => {
    renderPanel();

    expect(await screen.findByText(/No parties yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/None of these roles sign/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/are the ones asked to sign/i)).not.toBeInTheDocument();
  });

  it('makes the first party on an empty register the primary one', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /add party/i }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  Northlake Estates  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(CONTRACT_ID, {
      contract_id: CONTRACT_ID,
      party_role: 'employer',
      party_type: 'external',
      display_name: 'Northlake Estates',
      is_primary: true,
    });
  });

  it('does not make a second party primary', async () => {
    listMock.mockResolvedValue([party()]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /add party/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contractor' } });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Bramwell Civil Works' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      CONTRACT_ID,
      expect.objectContaining({ party_role: 'contractor', is_primary: false }),
    );
  });

  it('will not submit a blank name', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /add party/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('deletes a party by its own id, not through the contract', async () => {
    listMock.mockResolvedValue([party({ id: 'p-42' })]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /remove party/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith('p-42');
  });
});
