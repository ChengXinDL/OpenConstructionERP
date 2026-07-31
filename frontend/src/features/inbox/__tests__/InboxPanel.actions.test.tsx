// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The inbox row actions. The point of these is that the buttons reach the
// server: before this the panel was read-only, so a row could be looked at and
// nothing else. The dismissal test also pins down the promise the UI makes
// about approvals - taking one off the list must not read as deciding it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { InboxItem, InboxResponse } from '../api';

vi.mock('../api', () => ({
  fetchInbox: vi.fn(),
  acknowledgeInboxItem: vi.fn(),
  dismissInboxItem: vi.fn(),
  restoreInboxItem: vi.fn(),
}));

import {
  acknowledgeInboxItem,
  dismissInboxItem,
  fetchInbox,
  restoreInboxItem,
} from '../api';
import { InboxPanel } from '../InboxPanel';
import { useToastStore } from '@/stores/useToastStore';

function alertItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'notification:11111111-1111-1111-1111-111111111111',
    kind: 'alert',
    source: 'notification',
    title: 'RFI 12 is overdue',
    project_id: 'p-1',
    project_name: 'Riverside',
    action_url: '/rfis',
    severity: 'critical',
    created_at: '2026-06-20T10:00:00Z',
    acknowledged: false,
    ...overrides,
  };
}

function approvalItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'change_order_approval:22222222-2222-2222-2222-222222222222',
    kind: 'approval',
    source: 'change_order_approval',
    title: 'CO-7 waits on you',
    project_id: 'p-1',
    project_name: 'Riverside',
    action_url: '/changeorders',
    severity: 'warning',
    created_at: '2026-06-19T10:00:00Z',
    acknowledged: false,
    ...overrides,
  };
}

function payload(items: InboxItem[]): InboxResponse {
  const approvals = items.filter((i) => i.kind === 'approval').length;
  return {
    items,
    total: items.length,
    approvals_count: approvals,
    alerts_count: items.length - approvals,
    generated_at: '2026-06-21T00:00:00Z',
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inbox']}>
        <InboxPanel limit={8} showHeader={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [], history: [] });
  vi.mocked(fetchInbox).mockResolvedValue(payload([alertItem()]));
  vi.mocked(acknowledgeInboxItem).mockResolvedValue({
    item_id: 'x',
    state: 'acknowledged',
    findings: [],
  });
  vi.mocked(dismissInboxItem).mockResolvedValue({
    item_id: 'x',
    state: 'dismissed',
    findings: [],
  });
  vi.mocked(restoreInboxItem).mockResolvedValue({ item_id: 'x', state: null, findings: [] });
});

describe('InboxPanel row actions', () => {
  it('acknowledges a row through the API', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Mark as seen/i }));

    await waitFor(() => {
      expect(acknowledgeInboxItem).toHaveBeenCalledWith(
        'notification:11111111-1111-1111-1111-111111111111',
      );
    });
    expect(dismissInboxItem).not.toHaveBeenCalled();
  });

  it('offers to undo an acknowledge once the row comes back flagged', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(payload([alertItem({ acknowledged: true })]));
    renderPanel();

    expect(await screen.findByText('Seen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark as not seen/i }));

    await waitFor(() => {
      expect(restoreInboxItem).toHaveBeenCalledWith(
        'notification:11111111-1111-1111-1111-111111111111',
      );
    });
  });

  it('dismisses a row and raises an undo', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Dismiss$/i }));

    await waitFor(() => {
      expect(dismissInboxItem).toHaveBeenCalledWith(
        'notification:11111111-1111-1111-1111-111111111111',
      );
    });
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.title).toBe('Removed from your inbox');
    expect(toast?.action?.label).toBe('Undo');

    // The undo has to work from the toast, by which point the row itself is
    // gone from the list - that is the whole reason it does not run through the
    // row's own mutation.
    toast?.action?.onClick();
    await waitFor(() => {
      expect(restoreInboxItem).toHaveBeenCalledWith(
        'notification:11111111-1111-1111-1111-111111111111',
      );
    });
  });

  it('says an approval it just hid is still undecided', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(payload([approvalItem()]));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Dismiss$/i }));

    await waitFor(() => {
      expect(dismissInboxItem).toHaveBeenCalled();
    });
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/still pending a decision/i);
  });

  it('leaves an alert dismissal without the approval caveat', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Dismiss$/i }));

    await waitFor(() => {
      expect(dismissInboxItem).toHaveBeenCalled();
    });
    expect(useToastStore.getState().toasts.at(-1)?.message).toBeUndefined();
  });

  it('keeps the row link and the row actions as separate controls', async () => {
    renderPanel();
    const link = await screen.findByRole('button', { name: /RFI 12 is overdue/i });
    // A button nested inside a button is invalid HTML and swallows clicks; the
    // navigate target must not contain the action buttons.
    expect(link.querySelector('button')).toBeNull();
  });
});
