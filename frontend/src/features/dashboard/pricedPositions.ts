// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The "Priced positions" KPI tile used to read a synthesized proxy: the
// dashboard collapsed every project's positions into a one-element array
// carrying a 0/1 flag, and the tile then counted that array as if it were
// the positions themselves. With one project holding 1 priced and 99
// unpriced positions the tile computed 1/1 and rendered 100 percent, in
// green - the opposite of the user's state, with a colour confirming it.
//
// The rollup already carries the real numbers (``position_count`` and
// ``positions_zero_price`` on ``boq_summary``), which is what the
// BOQSummaryWidget in components/NewWidgets.tsx has always used for its
// "Zero priced" figure. This is that arithmetic, lifted out so the tile
// and the widget cannot drift and so it can be tested without mounting a
// 2700-line page.

/** The two counts the tile needs, as the ``boq_summary`` rollup reports them. */
export interface PositionCounts {
  /** Every BOQ position across the caller's projects. */
  position_count: number;
  /** Of those, how many carry no price. */
  positions_zero_price: number;
}

/** A measurable priced-positions reading. ``pct`` is 0-100, rounded. */
export interface PricedPositions {
  priced: number;
  total: number;
  pct: number;
}

/**
 * Share of positions that carry a price, or ``null`` when there is nothing
 * to measure.
 *
 * ``null`` is the honest answer for an empty denominator and is deliberately
 * not 0 percent: a project with no positions has not failed to price them,
 * it has not written them yet, and a red 0 percent would read as a problem
 * the user does not have. The caller renders ``null`` as an empty state
 * pointing at the BOQ editor.
 *
 * Counts are clamped rather than trusted: a backend that reported more
 * unpriced positions than positions would otherwise produce a negative
 * numerator and a negative percentage on screen.
 */
export function pricedPositions(counts: PositionCounts | null | undefined): PricedPositions | null {
  if (!counts) return null;

  const total = Math.max(0, Math.trunc(counts.position_count) || 0);
  if (total === 0) return null;

  const unpriced = Math.min(total, Math.max(0, Math.trunc(counts.positions_zero_price) || 0));
  const priced = total - unpriced;

  return { priced, total, pct: Math.round((priced / total) * 100) };
}
