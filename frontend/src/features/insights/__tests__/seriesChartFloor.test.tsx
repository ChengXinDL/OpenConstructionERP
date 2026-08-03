// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko
/**
 * #162 - the shared chart primitive drew whatever it was given. One row
 * became a donut with a single segment, one month became a line with one
 * point. It had an empty-state guard and nothing between that and a chart.
 *
 * WHAT THIS TEST COVERS AND WHAT IT DOES NOT. It covers the decision: given
 * n points of a kind, does the primitive draw or does it say "not enough
 * data". That is the logic that was missing and it is fully checkable here.
 *
 * It does NOT show what either state looks like. jsdom gives every element a
 * zero size, and recharts renders through a ResponsiveContainer that needs a
 * measurable box, so nothing in this file paints. Whether the refusal reads
 * as a working panel rather than a broken one, and whether the sentence fits
 * a 200px-tall card in a language with longer words than English, needs a
 * human at a browser.
 *
 * Run:  npx vitest run src/features/insights/__tests__/seriesChartFloor.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

import { SeriesChart } from '../charts';
import type { SeriesPoint } from '../aggregate';

/** n points named a, b, c... each with a distinct value. */
function points(n: number): SeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    name: String.fromCharCode(97 + i),
    value: (i + 1) * 10,
  })) as SeriesPoint[];
}

const NOT_ENOUGH = 'chart-not-enough-data';

describe('SeriesChart withholds a chart it cannot honestly draw (#162)', () => {
  it('refuses a donut of one segment', () => {
    const { container } = render(<SeriesChart points={points(1)} kind="donut" />);

    expect(screen.getByTestId(NOT_ENOUGH)).toBeInTheDocument();
    // The load-bearing half: it must not ALSO have drawn. An added message
    // over a still-drawn single-segment donut would pass a text assertion
    // and leave the defect on screen.
    expect(container.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('draws a donut once there are two segments', () => {
    const { container } = render(<SeriesChart points={points(2)} kind="donut" />);

    expect(screen.queryByTestId(NOT_ENOUGH)).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('refuses a line of one point and of two', () => {
    for (const n of [1, 2]) {
      const { container, unmount } = render(<SeriesChart points={points(n)} kind="line" />);
      expect(screen.getByTestId(NOT_ENOUGH)).toBeInTheDocument();
      expect(container.querySelector('.recharts-responsive-container')).toBeNull();
      unmount();
    }
  });

  it('draws a line at three points', () => {
    const { container } = render(<SeriesChart points={points(3)} kind="line" />);

    expect(screen.queryByTestId(NOT_ENOUGH)).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('keeps the em-dash for genuinely empty data', () => {
    // Distinct states. "No rows at all" has nothing to explain; "one row" is
    // the case that needs a sentence. Collapsing them would make an empty
    // register claim its data was merely thin.
    const { container } = render(<SeriesChart points={[]} kind="bar" />);

    expect(screen.queryByTestId(NOT_ENOUGH)).toBeNull();
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
    expect(container.textContent).toContain('—');
  });

  it('says it in words rather than leaving a bare dash', () => {
    render(<SeriesChart points={points(1)} kind="bar" />);

    expect(screen.getByTestId(NOT_ENOUGH)).toHaveTextContent('Not enough data');
  });
});
