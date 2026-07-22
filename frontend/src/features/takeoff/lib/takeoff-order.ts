// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Measurement paint (z) order helpers (issue #379).
 *
 * Takeoff measurements paint in array order (later index = painted on top),
 * and until now the user could not influence it: the only way to bring a shape
 * to the front was to delete and redraw it. These helpers give a measurement an
 * optional explicit ``order`` key that drives the paint order everywhere it
 * matters - the canvas paint pass, the click hit-test precedence, the sidebar
 * list and the PDF export - so a bring-to-front / send-to-back stays consistent
 * across all four surfaces and survives a reload (the key round-trips via the
 * measurement metadata blob, so no schema change is needed).
 *
 * A measurement the user never reordered carries no ``order``; it then falls
 * back to its position in the array (creation order, the stable #375 baseline),
 * so existing measurements are painted exactly as before.
 */

/** Minimal shape the ordering helpers need: an optional numeric order key. */
export interface Orderable {
  order?: number;
}

/**
 * Stable projection of a measurement list into paint (z) order.
 *
 * Higher effective order paints later (on top). The effective order of a row is
 * its explicit ``order`` when set, else its index in the input array, so a set
 * with no explicit keys is returned in its original order. Ties (an explicit
 * key equal to another row's index, or two equal keys) break on the original
 * index, keeping the sort deterministic and stable.
 *
 * Does not mutate the input.
 */
export function sortByPaintOrder<T extends Orderable>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, key: item.order ?? index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Compute the ``order`` value that moves one row to an edge of the stack.
 *
 * ``edge: 'front'`` returns ``max(effective order) + 1`` so the row paints on
 * top of every other row in ``subset``; ``edge: 'back'`` returns
 * ``min(effective order) - 1`` so it paints beneath them. The effective order
 * uses the same index fallback as {@link sortByPaintOrder}, so bring-to-front
 * works even when nothing in ``subset`` has an explicit key yet. Only the moved
 * row's key changes - neighbours are never renumbered - so a reorder is a
 * single-row edit (one PATCH), not a bulk rewrite.
 *
 * Returns ``null`` when ``subset`` is empty (nothing to compare against).
 */
export function orderKeyForEdge<T extends Orderable>(
  subset: T[],
  edge: 'front' | 'back',
): number | null {
  if (subset.length === 0) return null;
  // Reduce rather than spread into Math.max/min: a large document can hold
  // thousands of measurements, and ``Math.max(...bigArray)`` can overflow the
  // call stack.
  let acc = subset[0]!.order ?? 0;
  for (let i = 1; i < subset.length; i++) {
    const key = subset[i]!.order ?? i;
    acc = edge === 'front' ? Math.max(acc, key) : Math.min(acc, key);
  }
  return edge === 'front' ? acc + 1 : acc - 1;
}
