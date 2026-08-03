// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Arithmetic for the "Priced positions" tile (#187). The tile's wiring is
// covered separately in __tests__/KpiPricedPositions.test.tsx - this file
// only pins the function's edges, which are cheap to enumerate here and
// expensive to enumerate through a mounted page.

import { describe, it, expect } from 'vitest';
import { pricedPositions } from './pricedPositions';

describe('pricedPositions', () => {
  it('is null while the rollup has not arrived', () => {
    expect(pricedPositions(undefined)).toBeNull();
    expect(pricedPositions(null)).toBeNull();
  });

  it('is null over a zero denominator rather than 0 or 100 percent', () => {
    expect(pricedPositions({ position_count: 0, positions_zero_price: 0 })).toBeNull();
  });

  it('reports the real share, not the share of projects', () => {
    // The defect shape: one project, 1 priced of 100. The proxy this
    // replaced collapsed that to a single flag and read 100%.
    expect(pricedPositions({ position_count: 100, positions_zero_price: 99 })).toEqual({
      priced: 1,
      total: 100,
      pct: 1,
    });
  });

  it('reads 0 percent when every position is unpriced', () => {
    expect(pricedPositions({ position_count: 40, positions_zero_price: 40 })).toEqual({
      priced: 0,
      total: 40,
      pct: 0,
    });
  });

  it('reads 100 percent only when none are unpriced', () => {
    expect(pricedPositions({ position_count: 40, positions_zero_price: 0 })).toEqual({
      priced: 40,
      total: 40,
      pct: 100,
    });
  });

  it('rounds to the nearest whole percent', () => {
    expect(pricedPositions({ position_count: 3, positions_zero_price: 1 })?.pct).toBe(67);
    expect(pricedPositions({ position_count: 6, positions_zero_price: 5 })?.pct).toBe(17);
  });

  it('never reports a negative share when the counts contradict each other', () => {
    // A backend reporting more unpriced positions than positions would
    // otherwise put "-900%" on the dashboard.
    expect(pricedPositions({ position_count: 10, positions_zero_price: 100 })).toEqual({
      priced: 0,
      total: 10,
      pct: 0,
    });
  });

  it('survives non-finite counts instead of rendering NaN%', () => {
    expect(
      pricedPositions({ position_count: Number.NaN, positions_zero_price: 0 }),
    ).toBeNull();
    expect(
      pricedPositions({ position_count: 10, positions_zero_price: Number.NaN }),
    ).toEqual({ priced: 10, total: 10, pct: 100 });
  });
});
