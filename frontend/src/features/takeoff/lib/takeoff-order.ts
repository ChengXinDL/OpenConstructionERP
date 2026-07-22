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

/**
 * Order key that inserts a row between two effective paint keys (issue #379
 * drag-to-reorder). A ``null`` bound means the very back (``below``) or the very
 * front (``above``) of the stack, so the row steps one unit past the present
 * edge; between two real keys it takes their midpoint, which keeps the moved row
 * strictly between its new neighbours without renumbering them (a single-row
 * PATCH). With both bounds null (an empty stack) it returns 0.
 */
export function orderKeyBetween(below: number | null, above: number | null): number {
  if (below === null && above === null) return 0;
  if (below === null) return above! - 1;
  if (above === null) return below! + 1;
  return (below + above) / 2;
}

/**
 * Compute the ``order`` key that drops ``draggedId`` next to ``targetId`` in the
 * paint-order projection (issue #379). ``place`` decides whether the dragged row
 * lands immediately before or after the target in that projection. Effective
 * keys use the same ``order ?? array-index`` fallback as {@link sortByPaintOrder}
 * so the result is consistent with the canvas / hit-test / sidebar ordering, and
 * the dragged row is excluded when picking the neighbours so it does not compare
 * against its own old slot.
 *
 * Returns ``null`` when the target is missing or the drop is a no-op (the
 * dragged row would keep its current key), so the caller can skip the update.
 */
export function orderKeyForDrop<T extends Orderable & { id: string }>(
  items: readonly T[],
  draggedId: string,
  targetId: string,
  place: 'before' | 'after',
): number | null {
  if (draggedId === targetId) return null;
  // Effective key per row, indexed on the ORIGINAL array position so the
  // fallback matches sortByPaintOrder; then drop the dragged row and sort.
  const keyed = items
    .map((item, index) => ({ id: item.id, order: item.order, key: item.order ?? index }))
    .filter((k) => k.id !== draggedId)
    .sort((a, b) => a.key - b.key);
  const targetIdx = keyed.findIndex((k) => k.id === targetId);
  if (targetIdx === -1) return null;
  const insertAt = place === 'before' ? targetIdx : targetIdx + 1;
  const below = insertAt > 0 ? keyed[insertAt - 1]!.key : null;
  const above = insertAt < keyed.length ? keyed[insertAt]!.key : null;
  const newOrder = orderKeyBetween(below, above);
  const dragged = items.find((m) => m.id === draggedId);
  if (dragged && dragged.order === newOrder) return null;
  return newOrder;
}
