// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko
/**
 * #162 - the twin of the SeriesChart fix.
 *
 * QuickInsightPanel has its own chart renderer, `ChartBody`, with its own
 * switch over chart_type. It had the same hole: an empty-data guard and
 * nothing between that and drawing. Fixing only the insights primitive would
 * have left every Quick Insights panel drawing donuts of one, which is why
 * this file exists separately rather than trusting the shared helper's own
 * unit test to cover both callers.
 *
 * The two renderers take different shapes - `SeriesChart` takes `kind` plus
 * `{name, value}[]`, `ChartBody` takes a whole chart object with `x_field` /
 * `y_field` - so they cannot share a call site. They share the floor table
 * instead, and this test is what says the second caller actually reads it.
 *
 * WHAT IT CANNOT DO: same as its twin. jsdom paints nothing, so this covers
 * the decision to draw, not what either state looks like.
 *
 * Run:  npx vitest run src/features/dashboards/__tests__/quickInsightFloor.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const harness = vi.hoisted(() => ({ charts: [] as unknown[] }));

// `initReactI18next` is required because @/shared/ui pulls in ErrorBoundary,
// which imports it at module scope. A mock missing it fails at import time,
// before any test runs.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  withTranslation: () => (c: unknown) => c,
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { charts: harness.charts },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../api', () => ({
  getQuickInsights: vi.fn(),
  createDashboardPreset: vi.fn(),
}));

vi.mock('../PresetPicker', () => ({ PresetPicker: () => null }));

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

import { QuickInsightPanel } from '../QuickInsightPanel';

/** A chart of `n` points in the shape the endpoint returns. */
function chart(chartType: string, n: number) {
  return {
    chart_type: chartType,
    title: `${chartType} of ${n}`,
    x_field: 'name',
    y_field: 'value',
    agg_fn: 'count',
    interestingness: 1,
    data: Array.from({ length: n }, (_, i) => ({
      name: String.fromCharCode(97 + i),
      value: (i + 1) * 10,
    })),
  };
}

function renderWith(charts: unknown[]) {
  harness.charts = charts;
  return render(<QuickInsightPanel snapshotId="s1" />);
}

const NOT_ENOUGH = 'chart-not-enough-data';

describe('Quick Insights withholds a chart it cannot honestly draw (#162)', () => {
  it('refuses a donut of one segment', () => {
    const { container } = renderWith([chart('donut', 1)]);

    expect(screen.getByTestId(NOT_ENOUGH)).toBeInTheDocument();
    // As with the other renderer: the message must REPLACE the chart, not
    // sit above one that still draws.
    expect(container.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('draws a donut of two', () => {
    const { container } = renderWith([chart('donut', 2)]);

    expect(screen.queryByTestId(NOT_ENOUGH)).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('refuses a line of two points and draws one of three', () => {
    const two = renderWith([chart('line', 2)]);
    expect(screen.getByTestId(NOT_ENOUGH)).toBeInTheDocument();
    two.unmount();

    const three = renderWith([chart('line', 3)]);
    expect(screen.queryByTestId(NOT_ENOUGH)).toBeNull();
    expect(three.container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('refuses a scatter below five points, matching the backend', () => {
    // scatter is the one kind SeriesChart has no case for, so this floor is
    // only ever exercised through this renderer.
    renderWith([chart('scatter', 4)]);

    expect(screen.getByTestId(NOT_ENOUGH)).toBeInTheDocument();
  });

  it('holds each chart to its own floor within one panel', () => {
    // Four points draws a bar and refuses a scatter. If the guard were
    // applied per panel rather than per chart, one thin chart would blank
    // its neighbours - which would be a worse defect than the one fixed.
    const { container } = renderWith([chart('bar', 4), chart('scatter', 4)]);

    expect(screen.getAllByTestId(NOT_ENOUGH)).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-responsive-container')).toHaveLength(1);
  });
});
