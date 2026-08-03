// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko
//
// Arithmetic for the "Priced positions" tile (#187). The tile's wiring is
// covered separately in __tests__/KpiPricedPositions.test.tsx - this file
// only pins the function's edges, which are cheap to enumerate here and
// expensive to enumerate through a mounted page.
//
// Two things are being pinned, and they are different in kind. The first is
// that the share is computed from real position counts rather than the 0/1
// per-project proxy that made 1-priced-of-100 render as 100%. The second is
// that a percentage is withheld below MIN_POSITIONS_FOR_PCT: "50%" over two
// positions is arithmetically correct and tells the user nothing, so the
// counts carry the tile at that size and the percentage does not appear.

import { describe, it, expect } from 'vitest';
import { pricedPositions, MIN_POSITIONS_FOR_PCT } from './pricedPositions';

describe('pricedPositions', () => {
  it('is null only while the rollup has not arrived', () => {
    // Distinct from knowing the counts are zero - see the next test. This is
    // "we do not know yet", which the tile renders as a loading state.
    expect(pricedPositions(undefined)).toBeNull();
    expect(pricedPositions(null)).toBeNull();
  });

  it('treats an empty BOQ as a reading, not as a missing one', () => {
    // Zero is not a special case: "0 of 0 priced" is the truth, and it needs
    // no branch of its own. What it must not do is render a percentage -
    // 0% would accuse the user of not pricing positions they have not
    // written, and the old proxy rendered this state as 100%.
    expect(pricedPositions({ position_count: 0, positions_zero_price: 0 })).toEqual({
      priced: 0,
      total: 0,
      pct: null,
    });
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
    expect(pricedPositions({ position_count: 30, positions_zero_price: 10 })?.pct).toBe(67);
    expect(pricedPositions({ position_count: 60, positions_zero_price: 50 })?.pct).toBe(17);
  });

  it('withholds the percentage below the floor but still reports the counts', () => {
    // The whole point of the floor. One priced of two is "50%", which reads
    // like a project half costed; the counts say the same thing without
    // inviting anyone to act on it.
    const small = pricedPositions({ position_count: 2, positions_zero_price: 1 });
    expect(small).toEqual({ priced: 1, total: 2, pct: null });
  });

  it('starts reporting a percentage exactly at the floor', () => {
    // Pinning both sides of the boundary, because an off-by-one here is
    // invisible on screen - the tile just quietly shows a dash on a BOQ
    // that should have earned a figure.
    const below = pricedPositions({
      position_count: MIN_POSITIONS_FOR_PCT - 1,
      positions_zero_price: 0,
    });
    const at = pricedPositions({
      position_count: MIN_POSITIONS_FOR_PCT,
      positions_zero_price: 0,
    });

    expect(below?.pct).toBeNull();
    expect(below?.total).toBe(MIN_POSITIONS_FOR_PCT - 1);
    expect(at?.pct).toBe(100);
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
    // NaN collapses to a zero count, which is now a real reading rather than
    // null - so the assertion is that no NaN reaches the percentage, not
    // that the whole result disappears.
    expect(pricedPositions({ position_count: Number.NaN, positions_zero_price: 0 })).toEqual({
      priced: 0,
      total: 0,
      pct: null,
    });
    expect(pricedPositions({ position_count: 10, positions_zero_price: Number.NaN })).toEqual({
      priced: 10,
      total: 10,
      pct: 100,
    });
  });
});
