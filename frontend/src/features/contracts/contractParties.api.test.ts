// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Path tests for the contract party register client.
//
// These exist because the component tests cannot catch what went wrong here.
// They stub the whole api module, so they check that the panel passes a party
// its own id and not the contract's, and are blind to the URL that id is put
// into. Delete shipped pointing at /v1/contracts/parties/{id} and answered 404
// on every row: the module router is mounted at /v1/contracts and the route is
// /contracts/parties/{id}, so the word appears twice in the real path.
//
// A 404 from a wrong route is indistinguishable in the UI from a 404 for a row
// that is not there, which is why this is worth pinning rather than eyeballing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn(() => Promise.resolve([])),
  apiPost: vi.fn(() => Promise.resolve({})),
  apiPatch: vi.fn(() => Promise.resolve({})),
  apiPut: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve(undefined)),
  triggerDownload: vi.fn(),
  getErrorMessage: (e: unknown) => String(e),
  API_BASE: '/api',
}));

import { apiGet, apiPost, apiDelete } from '@/shared/lib/api';
import {
  listContractParties,
  createContractParty,
  deleteContractParty,
} from './api';

const CONTRACT_ID = 'c-1';
const PARTY_ID = 'p-42';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('contract party endpoints', () => {
  it('lists parties under the contract', async () => {
    await listContractParties(CONTRACT_ID);
    expect(apiGet).toHaveBeenCalledWith(
      `/v1/contracts/contracts/${CONTRACT_ID}/parties`,
    );
  });

  it('creates a party under the contract', async () => {
    const body = {
      contract_id: CONTRACT_ID,
      party_role: 'employer',
      party_type: 'external',
      display_name: 'Northlake Estates',
      is_primary: true,
    };
    await createContractParty(CONTRACT_ID, body);
    expect(apiPost).toHaveBeenCalledWith(
      `/v1/contracts/contracts/${CONTRACT_ID}/parties`,
      body,
    );
  });

  it('deletes a party by id, on the route that actually exists', async () => {
    await deleteContractParty(PARTY_ID);
    expect(apiDelete).toHaveBeenCalledWith(
      `/v1/contracts/contracts/parties/${PARTY_ID}`,
    );
  });

  it('does not address a party through the contract collection', async () => {
    await deleteContractParty(PARTY_ID);
    const call = vi.mocked(apiDelete).mock.calls[0];
    expect(call).toBeDefined();
    const path = String(call?.[0]);
    expect(path).not.toContain(CONTRACT_ID);
    // The single-segment form is the bug this file exists for.
    expect(path).not.toBe(`/v1/contracts/parties/${PARTY_ID}`);
  });
});
