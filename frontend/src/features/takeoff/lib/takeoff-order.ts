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

/** Minimal shape the ordering helpers need: an optional numeric order key and
 *  the group the row belongs to (issue #394 bands the projection by group). */
export interface Orderable {
  order?: number;
  group?: string;
}

/** Group name a row with no group of its own is filed under. Matches the
 *  `m.group || 'General'` idiom the sidebar and the exporters bucket with, so a
 *  row whose group is an empty string bands where it is displayed. A `??`
 *  fallback would band it separately from the bucket it renders in. */
const DEFAULT_GROUP = 'General';

/** Empty band map. Every group then resolves to band 0, so a banded sort
 *  collapses to the single-level behaviour and callers that pass nothing are
 *  unaffected. */
const NO_GROUP_ORDER: Readonly<Record<string, number>> = {};

/**
 * Resolve the group a row bands, buckets and scopes under.
 *
 * Exported so every surface that groups measurements normalises the same way.
 * A raw `a.group === b.group` comparison splits an empty-string group away from
 * the General bucket it actually renders in, which silently scopes an operation
 * to the wrong set; going through here is what keeps banding, bucketing and the
 * band-scoped bring-to-front / send-to-back agreeing on what a group is.
 */
export const groupOf = (item: Orderable): string => item.group || DEFAULT_GROUP;

/**
 * Assign each group a band, deciding where its block sits relative to the other
 * groups (issue #394).
 *
 * Until now a group's position was a side effect of its members' paint keys: a
 * group block sat wherever its earliest member happened to land, so restacking
 * one measurement relocated its whole group. A band gives the group a position
 * of its own, and defaults it to first appearance in the array - creation order,
 * which no per-measurement reorder can change.
 *
 * ``explicit`` wins where it is set, and any group missing from it is banded
 * after the highest explicit band, in first-appearance order. Passing nothing
 * makes the whole map derived: opening a document writes nothing, and two
 * clients looking at the same measurements compute the same bands without
 * either having to store them (issue #400 is what fills ``explicit`` in).
 */
export function groupBands<T extends Orderable>(
  items: readonly T[],
  explicit: Readonly<Record<string, number>> = NO_GROUP_ORDER,
): Record<string, number> {
  const bands: Record<string, number> = { ...explicit };
  // Derived bands start above every explicit one so an un-banded group never
  // displaces a group the user positioned deliberately.
  let next = 0;
  for (const band of Object.values(explicit)) next = Math.max(next, band + 1);
  for (const item of items) {
    const group = groupOf(item);
    if (bands[group] === undefined) bands[group] = next++;
  }
  return bands;
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
 * ``groupOrder`` makes the projection band-major (issue #394): rows sort by
 * their group's band first, so every group paints as one contiguous block and a
 * measurement-level reorder can no longer move its group. Omitting it leaves
 * every row in band 0, which collapses the comparator to the ``key`` / ``index``
 * tie-breaks above - so every existing caller keeps its current behaviour.
 *
 * Does not mutate the input.
 */
export function sortByPaintOrder<T extends Orderable>(
  items: T[],
  groupOrder: Readonly<Record<string, number>> = NO_GROUP_ORDER,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      band: groupOrder[groupOf(item)] ?? 0,
      key: item.order ?? index,
    }))
    .sort((a, b) => a.band - b.band || a.key - b.key || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Compute the band map that drops one group next to another (issue #400).
 *
 * Unlike a measurement drop, this renumbers every group sequentially rather
 * than handing the moved group a fractional key between its new neighbours.
 * The reason is {@link groupBands}' creation-order default: it bands every
 * group with no explicit entry AFTER the highest explicit one. Banding the
 * dragged group alone would therefore push every untouched group above it -
 * dropping ``C`` between ``A`` and ``B`` with nothing banded yet would give
 * ``C`` 0.5 and then re-derive ``A`` and ``B`` above it, landing ``C`` at the
 * front instead of the middle. Stamping every group in one pass is what makes
 * the result the order the user actually dropped.
 *
 * ``displayed`` must list EVERY group in the document, not just the groups on
 * the current page: the band map is per document, so renumbering only the
 * visible subset would drop the band of every group that lives on another page.
 *
 * Returns ``null`` when the move changes nothing (same group, either name
 * missing, or the drop resolves to the slot the group already occupies), so the
 * caller can skip a write that would otherwise re-stamp every measurement.
 */
export function reorderGroups(
  displayed: readonly string[],
  draggedGroup: string,
  targetGroup: string,
  place: 'before' | 'after',
): Record<string, number> | null {
  if (draggedGroup === targetGroup) return null;
  if (!displayed.includes(draggedGroup) || !displayed.includes(targetGroup)) return null;
  // Remove the dragged group BEFORE resolving the target's index. Splicing at
  // the target's index in the original list would put a group dragged from
  // above the target straight back where it started, so the move would silently
  // no-op in exactly the direction users try first.
  const rest = displayed.filter((g) => g !== draggedGroup);
  const targetIdx = rest.indexOf(targetGroup);
  if (targetIdx === -1) return null;
  const insertAt = place === 'before' ? targetIdx : targetIdx + 1;
  const next = [...rest.slice(0, insertAt), draggedGroup, ...rest.slice(insertAt)];
  // A drop back into the same slot is not worth a document-wide write.
  if (next.every((g, i) => g === displayed[i])) return null;
  const bands: Record<string, number> = {};
  next.forEach((g, i) => {
    bands[g] = i;
  });
  return bands;
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
