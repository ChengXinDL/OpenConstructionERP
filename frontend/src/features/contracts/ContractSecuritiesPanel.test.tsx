// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
//
// Component tests for <ContractSecuritiesPanel>.
//
// Three things here are wrong in a way a healthy-looking screen does not show,
// and they are what these tests pin:
//
//   * the face value is a Decimal carried as a string. An edit that only moves
//     the expiry date must send the amount back byte for byte. Parsing it to a
//     float and re-serialising loses trailing precision on exactly the large
//     round numbers bonds are written for, and the screen would look identical.
//   * currency is per instrument. A bond issued in CHF against a EUR contract
//     is the normal case, and inheriting the contract's currency at display
//     time misstates the cover by the exchange rate with nothing on screen to
//     say so.
//   * a date the register already holds cannot be cleared: the service drops
//     nulls before it writes. Sending the empty box anyway would 422 on the
//     date pattern; sending nothing and saying nothing would look like it
//     worked. The panel has to say so.
//
// The api module is stubbed whole, so the two enum vocabularies it exports have
// to be stubbed with it: they are values, not types, and the form reads them at
// render time to build its dropdowns.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('./api', () => ({
  listContractSecurities: vi.fn(),
  createContractSecurity: vi.fn(),
  updateContractSecurity: vi.fn(),
  deleteContractSecurity: vi.fn(),
  CONTRACT_SECURITY_TYPES: [
    'performance_bond',
    'payment_bond',
    'advance_payment_bond',
    'retention_bond',
    'parent_company_guarantee',
    'bank_guarantee',
    'insurance_pl',
    'insurance_car',
    'insurance_pi',
    'other',
  ] as const,
  CONTRACT_SECURITY_STATUSES: [
    'required',
    'received',
    'active',
    'expired',
    'released',
    'claimed',
  ] as const,
}));

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) =>
    sel({ addToast: vi.fn() }),
}));

import { ContractSecuritiesPanel } from './ContractSecuritiesPanel';
import * as api from './api';
import type { ContractSecurity } from './api';

const listMock = vi.mocked(api.listContractSecurities);
const createMock = vi.mocked(api.createContractSecurity);
const updateMock = vi.mocked(api.updateContractSecurity);
const deleteMock = vi.mocked(api.deleteContractSecurity);

const CONTRACT_ID = 'c-1';

/** A UTC ``YYYY-MM-DD`` offset from today, so the window never dates the test. */
function isoDaysFromToday(days: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  );
  return d.toISOString().slice(0, 10);
}

function security(over: Partial<ContractSecurity> = {}): ContractSecurity {
  return {
    id: 's-1',
    contract_id: CONTRACT_ID,
    security_type: 'performance_bond',
    reference: 'PB-2026-0041',
    provider_name: 'Meridian Surety',
    amount: '1250000.5000',
    currency: 'EUR',
    percent_of_contract: '10.0000',
    valid_from: '2026-01-15',
    valid_to: isoDaysFromToday(300),
    status: 'active',
    document_id: null,
    notes: null,
    metadata: {},
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
    ...over,
  };
}

function renderPanel(currency = 'EUR') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ContractSecuritiesPanel contractId={CONTRACT_ID} currency={currency} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  createMock.mockResolvedValue(security());
  updateMock.mockResolvedValue(security());
  deleteMock.mockResolvedValue(undefined);
});

describe('<ContractSecuritiesPanel>', () => {
  it('lists an instrument with its issuer, reference and type', async () => {
    listMock.mockResolvedValue([security()]);
    renderPanel();

    expect(await screen.findByText('Meridian Surety')).toBeInTheDocument();
    expect(screen.getByText('PB-2026-0041')).toBeInTheDocument();
    expect(screen.getByText('Performance bond')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows the row currency, not the contract currency', async () => {
    listMock.mockResolvedValue([security({ currency: 'CHF' })]);
    renderPanel('EUR');

    // The bond is in CHF against a EUR contract. Reading the contract's
    // currency here would restate a Swiss franc figure as euros.
    await screen.findByText('Meridian Surety');
    expect(document.body.textContent).toContain('CHF');
  });

  it('still shows the face value when the row carries no currency', async () => {
    // The API defaults `currency` to an empty string, so a seeded or imported
    // instrument arrives this way routinely. MoneyDisplay answers a missing
    // code with an em-dash and no number at all, which would delete the one
    // figure the row exists to carry.
    listMock.mockResolvedValue([security({ currency: '' })]);
    renderPanel('EUR');

    await screen.findByText('Meridian Surety');
    expect(screen.getByText(/1250000\.5000/)).toBeInTheDocument();
    expect(screen.getByText('(no currency)')).toBeInTheDocument();
  });

  it('does not restate an uncoded amount in the contract currency', async () => {
    listMock.mockResolvedValue([security({ currency: '' })]);
    renderPanel('EUR');

    await screen.findByText('Meridian Surety');
    // Falling back to the contract's currency here would assert a euro figure
    // the register never recorded.
    expect(document.body.textContent).not.toContain('EUR');
  });

  it('leaves a saved currency standing when the box is emptied', async () => {
    listMock.mockResolvedValue([security({ id: 's-42' })]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /edit security/i }));
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: '' } });

    expect(
      screen.getByText(/cannot be emptied here, only replaced/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    // Sending "" would be accepted and stored, and the value would then read
    // as an unqualified number on every later visit.
    const body = updateMock.mock.calls[0]?.[1];
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty('currency');
  });

  it('tells an expired instrument from one expiring soon and one that is fine', async () => {
    listMock.mockResolvedValue([
      security({ id: 's-past', valid_to: isoDaysFromToday(-5) }),
      security({ id: 's-soon', valid_to: isoDaysFromToday(10) }),
      security({ id: 's-far', valid_to: isoDaysFromToday(300) }),
    ]);
    renderPanel();

    expect(await screen.findByText('Expired 5d')).toBeInTheDocument();
    expect(screen.getByText('Expires 10d')).toBeInTheDocument();
    // The third row is inside neither window and carries no badge at all.
    expect(screen.queryByText(/Expires 300d/)).not.toBeInTheDocument();
  });

  it('says nothing about the expiry of an instrument already handed back', async () => {
    listMock.mockResolvedValue([
      security({ status: 'released', valid_to: isoDaysFromToday(-40) }),
    ]);
    renderPanel();

    expect(await screen.findByText('Released')).toBeInTheDocument();
    expect(screen.queryByText(/Expired 40d/)).not.toBeInTheDocument();
  });

  it('marks an open-ended instrument rather than leaving the expiry blank', async () => {
    listMock.mockResolvedValue([security({ valid_to: null })]);
    renderPanel();

    expect(await screen.findByText('Open-ended')).toBeInTheDocument();
  });

  it('sends the Decimal back unchanged when only the expiry is edited', async () => {
    listMock.mockResolvedValue([security({ id: 's-42' })]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /edit security/i }));
    fireEvent.change(screen.getByLabelText('Expiry'), {
      target: { value: '2027-06-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      's-42',
      expect.objectContaining({
        // Byte for byte off the wire. 1250000.5 would be the float round-trip.
        amount: '1250000.5000',
        percent_of_contract: '10.0000',
        valid_to: '2027-06-30',
      }),
    );
  });

  it('offers the contract currency on a new row and sends what was typed', async () => {
    renderPanel('GBP');

    fireEvent.click(await screen.findByRole('button', { name: /add security/i }));
    expect(screen.getByLabelText('Currency')).toHaveValue('GBP');

    fireEvent.change(screen.getByLabelText('Issuer'), {
      target: { value: 'Halden Bank' },
    });
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '250000.0000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      CONTRACT_ID,
      expect.objectContaining({
        contract_id: CONTRACT_ID,
        provider_name: 'Halden Bank',
        amount: '250000.0000',
        currency: 'GBP',
      }),
    );
  });

  it('will not submit a face value that is not a number', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /add security/i }));
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '1.2m' },
    });

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/Enter the face value as a number/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('will not submit a percentage above 100', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /add security/i }));
    fireEvent.change(screen.getByLabelText('% of contract'), {
      target: { value: '140' },
    });

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('says a saved date cannot be emptied, and does not send the empty box', async () => {
    listMock.mockResolvedValue([security({ id: 's-42' })]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /edit security/i }));
    fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '' } });

    expect(
      screen.getByText(/cannot be emptied here, only replaced/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    // An empty string fails the schema's date pattern outright, so the field is
    // left out and the stored value stands.
    const body = updateMock.mock.calls[0]?.[1];
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty('valid_to');
  });

  it('deletes a security by its own id, behind a confirmation', async () => {
    listMock.mockResolvedValue([security({ id: 's-42' })]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /remove security/i }));
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith('s-42');
  });

  it('says the register is empty rather than showing an empty table', async () => {
    renderPanel();

    expect(
      await screen.findByText(/No bonds, guarantees or insurance recorded/i),
    ).toBeInTheDocument();
  });
});
