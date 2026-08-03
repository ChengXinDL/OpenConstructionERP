// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko
/**
 * The minimum-n table the two chart renderers share.
 *
 * The defect: the primitives had an empty-state guard and nothing between
 * "no data" and a real chart, so one row rendered as a donut with a single
 * segment and one month rendered as a line with one point.
 *
 * These assertions pin the numbers against the backend constants they mirror
 * (`backend/app/modules/dashboards/insights.py`). That is the point of the
 * table - not that 2 and 3 and 5 are inherently right, but that one system
 * decides them and the other follows. A test that only checked "a floor
 * exists" would pass while the two drifted apart again.
 *
 * Run:  npx vitest run src/shared/lib/__tests__/chartDataFloor.test.ts
 */

import { describe, it, expect } from 'vitest';
import { hasEnoughPoints, MIN_POINTS } from '../chartDataFloor';

describe('chart minimum-n floors (#162)', () => {
  it('mirrors the backend numbers exactly', () => {
    // insights.py:96-97  _MIN_CATEGORICAL_FOR_DONUT / _FOR_BAR = 2
    // insights.py:319    line needs nunique() >= 3 timestamps
    // insights.py:361    scatter needs len(sub) >= 5
    // histogram is a deliberate deviation - see the module docstring.
    expect(MIN_POINTS).toEqual({
      donut: 2,
      bar: 2,
      histogram: 2,
      line: 3,
      area: 3,
      scatter: 5,
    });
  });

  it('refuses a donut of one segment', () => {
    // A single slice is a filled circle with a number next to it. It asserts
    // a breakdown, and there is nothing to break down.
    expect(hasEnoughPoints('donut', 1)).toBe(false);
    expect(hasEnoughPoints('donut', 2)).toBe(true);
  });

  it('refuses a line of one or two points', () => {
    // Two points are a straight segment, and a straight segment always
    // trends - whichever way the two values fall it looks like a direction.
    expect(hasEnoughPoints('line', 1)).toBe(false);
    expect(hasEnoughPoints('line', 2)).toBe(false);
    expect(hasEnoughPoints('line', 3)).toBe(true);
  });

  it('treats area as a line, because that is what it is', () => {
    expect(MIN_POINTS.area).toBe(MIN_POINTS.line);
    expect(hasEnoughPoints('area', 2)).toBe(false);
    expect(hasEnoughPoints('area', 3)).toBe(true);
  });

  it('refuses a bar chart of one bar', () => {
    expect(hasEnoughPoints('bar', 1)).toBe(false);
    expect(hasEnoughPoints('bar', 2)).toBe(true);
  });

  it('refuses a scatter below five points', () => {
    expect(hasEnoughPoints('scatter', 4)).toBe(false);
    expect(hasEnoughPoints('scatter', 5)).toBe(true);
  });

  it('lets an unknown chart kind through rather than blanking it', () => {
    // This guard exists to stop a chart overclaiming, not to become a new
    // way for a panel to render nothing. A shape nobody gave a floor to is
    // not thereby suspect, and a typo in a chart_type must not silently
    // empty every panel that uses it.
    expect(hasEnoughPoints('sankey', 1)).toBe(true);
    expect(hasEnoughPoints('', 0)).toBe(true);
  });

  it('does not floor on the sum of the values', () => {
    // Deliberate, and the reason belongs in a test because it is the guard's
    // main limit. These renderers receive aggregated points, so "three
    // categories of one record each" and "three costs of 1 EUR" arrive
    // identically. The second is legitimate data. Rejecting it would need
    // the record count, which lives upstream where the points are built.
    expect(hasEnoughPoints('bar', 3)).toBe(true);
  });
});
