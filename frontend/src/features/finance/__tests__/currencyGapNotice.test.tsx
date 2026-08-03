// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * #169 - a project with no currency blanked six Finance cards and the total
 * row, with the only explanation a per-cell tooltip.
 *
 * MoneyDisplay's guard is correct and is left alone: an amount printed
 * without its unit invites being read as the wrong currency. What was wrong
 * was that the screen said nothing. These tests pin the screen-level notice:
 * present and actionable when no currency resolves, absent when one does.
 *
 * Run:  npx vitest run src/features/finance/__tests__/currencyGapNotice.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FinanceSummaryCards } from '../FinancePage';

const harness = vi.hoisted(() => ({
  dashboard: {} as Record<string, unknown>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      if (typeof opts === 'object' && opts && 'defaultValue' in opts) {
        let dv = String(opts.defaultValue ?? '');
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue' || k === 'defaultValue_plural') continue;
          dv = dv.replaceAll(`{{${k}}}`, String(v));
        }
        return dv;
      }
      return _key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
  I18nextProvider: ({ children }: { children: unknown }) => children,
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: harness.dashboard,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPatch: vi.fn().mockResolvedValue({}),
  apiPut: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue(undefined),
  extractErrorMessageFromBody: () => null,
  getErrorMessage: (e: unknown) => String(e),
  triggerDownload: vi.fn(),
  API_BASE: '/api',
  getAuthToken: () => 'tok',
  ApiError: class ApiError extends Error {},
}));

/** A dashboard with real figures, so the cards render rather than the empty state. */
function dashboardWith(currency: string) {
  return {
    total_budget_original: 250_000,
    total_budget_revised: 260_000,
    total_committed: 90_000,
    total_actual: 120_000,
    total_variance: 140_000,
    budget_consumed_pct: 46,
    budget_warning_level: 'normal',
    total_payments: 100_000,
    total_payable: 40_000,
    total_receivable: 15_000,
    cash_flow_net: 60_000,
    currency,
  };
}

function renderCards() {
  return render(
    <MemoryRouter>
      <FinanceSummaryCards projectId="proj-1" />
    </MemoryRouter>,
  );
}

describe('Finance currency-gap notice (#169)', () => {
  it('says why the amounts are blank when no currency resolves', async () => {
    harness.dashboard = dashboardWith('');
    renderCards();

    const notice = await screen.findByTestId('finance-no-currency-notice');
    expect(notice).toBeInTheDocument();
    // The sentence has to name the cause. A generic "no data" would be the
    // same non-answer the tooltip was.
    expect(notice.textContent).toMatch(/currency/i);
  }, 120000);

  it('offers the place to set the currency, pointing at this project', async () => {
    harness.dashboard = dashboardWith('');
    renderCards();

    const link = await screen.findByRole('link', { name: /set the project currency/i });
    expect(link).toHaveAttribute('href', '/projects/proj-1');
  }, 120000);

  it('stays out of the way once the project has a currency', async () => {
    harness.dashboard = dashboardWith('EUR');
    renderCards();

    // The cards render, so we are past the empty state...
    expect(await screen.findByText(/250,000|250.000/)).toBeInTheDocument();
    // ...and the notice is not there.
    expect(screen.queryByTestId('finance-no-currency-notice')).not.toBeInTheDocument();
  }, 120000);
});
