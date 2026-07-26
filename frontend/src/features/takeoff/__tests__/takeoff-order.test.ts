// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
import { describe, it, expect } from 'vitest';
import {
  sortByPaintOrder,
  orderKeyForEdge,
  orderKeyBetween,
  orderKeyForDrop,
  groupBands,
  groupOf,
  reorderGroups,
} from '../lib/takeoff-order';

/** Minimal orderable rows for the projection tests. */
const row = (id: string, order?: number) => ({ id, order });

describe('sortByPaintOrder (issue #379)', () => {
  it('returns rows with no explicit order in their original array order', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(sortByPaintOrder(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by explicit order ascending (higher paints later / on top)', () => {
    const rows = [row('a', 3), row('b', 1), row('c', 2)];
    expect(sortByPaintOrder(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('mixes explicit keys with the array-index fallback deterministically', () => {
    // 'x' brought to front (order huge) tops the un-ordered rows; 'y' sent to
    // back (negative) drops below them; the rest keep array order.
    const rows = [row('p'), row('x', 99), row('q'), row('y', -1)];
    expect(sortByPaintOrder(rows).map((r) => r.id)).toEqual(['y', 'p', 'q', 'x']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('a', 2), row('b', 1)];
    const snapshot = rows.map((r) => r.id);
    sortByPaintOrder(rows);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

describe('orderKeyForEdge (issue #379)', () => {
  it('front returns a key strictly above every effective order', () => {
    const rows = [row('a'), row('b'), row('c')]; // effective 0,1,2
    const key = orderKeyForEdge(rows, 'front')!;
    // Placing the moved row at this key sorts it last (on top).
    const moved = sortByPaintOrder([...rows, row('z', key)]);
    expect(moved[moved.length - 1]!.id).toBe('z');
  });

  it('back returns a key strictly below every effective order', () => {
    const rows = [row('a', 5), row('b', 6)];
    const key = orderKeyForEdge(rows, 'back')!;
    const moved = sortByPaintOrder([row('z', key), ...rows]);
    expect(moved[0]!.id).toBe('z');
  });

  it('returns null for an empty subset', () => {
    expect(orderKeyForEdge([], 'front')).toBeNull();
    expect(orderKeyForEdge([], 'back')).toBeNull();
  });

  it('front stays above a previously front-most row (repeated bring-to-front)', () => {
    let rows = [row('a'), row('b')];
    const kA = orderKeyForEdge(rows, 'front')!;
    rows = [row('a', kA), row('b')];
    const kB = orderKeyForEdge(rows, 'front')!;
    expect(kB).toBeGreaterThan(kA);
  });
});

describe('orderKeyBetween (issue #379 drag reorder)', () => {
  it('takes the midpoint of two real bounds', () => {
    expect(orderKeyBetween(2, 4)).toBe(3);
    expect(orderKeyBetween(0, 1)).toBe(0.5);
  });

  it('steps one unit past an open edge', () => {
    expect(orderKeyBetween(null, 3)).toBe(2); // dropped at the very front
    expect(orderKeyBetween(3, null)).toBe(4); // dropped at the very back
  });

  it('returns 0 for an empty stack', () => {
    expect(orderKeyBetween(null, null)).toBe(0);
  });
});

describe('orderKeyForDrop (issue #379 drag reorder)', () => {
  it('drops a row before the target, landing it directly beneath in paint order', () => {
    // effective keys: a=0, b=1, c=2, d=3. Drag d before b.
    const rows = [row('a'), row('b'), row('c'), row('d')];
    const key = orderKeyForDrop(rows, 'd', 'b', 'before');
    expect(key).not.toBeNull();
    const sorted = sortByPaintOrder(
      rows.map((r) => (r.id === 'd' ? { ...r, order: key! } : r)),
    ).map((r) => r.id);
    expect(sorted).toEqual(['a', 'd', 'b', 'c']);
  });

  it('drops a row after the target', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')];
    const key = orderKeyForDrop(rows, 'a', 'c', 'after');
    const sorted = sortByPaintOrder(
      rows.map((r) => (r.id === 'a' ? { ...r, order: key! } : r)),
    ).map((r) => r.id);
    expect(sorted).toEqual(['b', 'c', 'a', 'd']);
  });

  it('excludes the dragged row when picking neighbours (drop to the very front)', () => {
    const rows = [row('a'), row('b'), row('c')];
    const key = orderKeyForDrop(rows, 'a', 'c', 'after');
    const sorted = sortByPaintOrder(
      rows.map((r) => (r.id === 'a' ? { ...r, order: key! } : r)),
    ).map((r) => r.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });

  it('returns null for a missing target or a self-drop', () => {
    const rows = [row('a'), row('b')];
    expect(orderKeyForDrop(rows, 'a', 'a', 'before')).toBeNull();
    expect(orderKeyForDrop(rows, 'a', 'zzz', 'before')).toBeNull();
  });

  /**
   * "After row N" and "before row N+1" name the same gap in the list, so the
   * two gestures a user can aim at that gap must produce the same key. This is
   * what makes issue #392's midpoint split safe: once the drop handler picks
   * 'before' or 'after' from which half of the row the pointer is in, the seam
   * between two adjacent rows is approached from both sides, and a user who
   * aims just below one row must not get a different result from one who aims
   * just above the next.
   */
  it('addresses the same gap whether reached as after-N or before-N+1', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')];
    expect(orderKeyForDrop(rows, 'a', 'b', 'after')).toBe(
      orderKeyForDrop(rows, 'a', 'c', 'before'),
    );
    expect(orderKeyForDrop(rows, 'd', 'b', 'after')).toBe(
      orderKeyForDrop(rows, 'd', 'c', 'before'),
    );
  });

  /**
   * The slot after the LAST row is the one issue #392 reports as unreachable:
   * every drop is computed as insert-before, so no pointer position produces
   * it. The helper can already express it - this pins that the 'after' branch
   * on the last row is what the drop handler has to call to reach it.
   */
  it('reaches the slot after the last row', () => {
    const rows = [row('a'), row('b'), row('c')];
    const key = orderKeyForDrop(rows, 'a', 'c', 'after');
    const sorted = sortByPaintOrder(
      rows.map((r) => (r.id === 'a' ? { ...r, order: key! } : r)),
    ).map((r) => r.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });
});

/* ── Group bands (issues #394 / #400) ─────────────────────────────── */

/** Orderable row carrying a group, for the banding tests. */
const grouped = (id: string, group: string, order?: number) => ({ id, group, order });

describe('groupOf (issue #394)', () => {
  it('normalises a missing or empty group to General', () => {
    // Every surface that groups measurements has to agree on what a group is.
    // A raw `m.group === other.group` comparison files an empty string apart
    // from the General bucket it renders in, which scopes an operation to the
    // wrong set - the same class of defect as a `??` fallback in place of `||`.
    expect(groupOf({})).toBe('General');
    expect(groupOf({ group: '' })).toBe('General');
    expect(groupOf({ group: 'Walls' })).toBe('Walls');
  });
});

describe('groupBands (issue #394)', () => {
  it('bands groups by first appearance, so a measurement reorder cannot move a group', () => {
    const rows = [
      grouped('w1', 'Walls'),
      grouped('w2', 'Walls'),
      grouped('s1', 'Slab'),
      grouped('s2', 'Slab'),
    ];
    expect(groupBands(rows)).toEqual({ Walls: 0, Slab: 1 });
    // The reported repro: send the last Slab row to the back. Its paint key
    // changes, but creation order is not something a reorder can touch, so the
    // bands are identical and the Slab block stays below Walls.
    const restacked = rows.map((r) => (r.id === 's2' ? { ...r, order: -1 } : r));
    expect(groupBands(restacked)).toEqual({ Walls: 0, Slab: 1 });
  });

  it('files a row with no group, or an empty group, under General', () => {
    // The sidebar and the exporters bucket with `m.group || 'General'`, so an
    // empty string must band where it is displayed rather than as its own
    // group - a `??` fallback would split the two apart.
    expect(groupBands([{ order: 0 }, { group: '', order: 1 }])).toEqual({ General: 0 });
  });

  it('prefers an explicit band and files the rest after the highest one', () => {
    const rows = [grouped('a', 'Alpha'), grouped('b', 'Bravo'), grouped('c', 'Charlie')];
    // Bravo was positioned deliberately; the other two must not displace it.
    expect(groupBands(rows, { Bravo: 0 })).toEqual({ Bravo: 0, Alpha: 1, Charlie: 2 });
  });

  it('keeps a fully explicit map untouched', () => {
    const rows = [grouped('a', 'Alpha'), grouped('b', 'Bravo')];
    expect(groupBands(rows, { Alpha: 5, Bravo: 2 })).toEqual({ Alpha: 5, Bravo: 2 });
  });
});

describe('sortByPaintOrder group bands (issue #394)', () => {
  it('leaves every existing caller unchanged when no band map is passed', () => {
    // The band parameter is additive: with no map every row lands in band 0 and
    // the comparator falls through to the key / index tie-breaks it always had.
    const rows = [grouped('a', 'Walls', 3), grouped('b', 'Slab', 1), grouped('c', 'Walls', 2)];
    expect(sortByPaintOrder(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('paints each group as one contiguous block, ordered by band', () => {
    const rows = [
      grouped('w1', 'Walls'),
      grouped('w2', 'Walls'),
      grouped('s1', 'Slab'),
      // Sent to the back. Unbanded this drags the whole Slab block above Walls,
      // which is the defect; banded it may only move within its own group.
      grouped('s2', 'Slab', -1),
    ];
    const bands = groupBands(rows);
    expect(sortByPaintOrder(rows, bands).map((r) => r.id)).toEqual(['w1', 'w2', 's2', 's1']);
  });

  it('orders blocks by band even when a group name looks like an integer', () => {
    // Group blocks used to be enumerated off a plain object, where integer-like
    // keys sort ahead of every named key regardless of insertion order. Bands
    // are numbers compared numerically, so a group named "2" stays where the
    // document put it.
    const rows = [grouped('a', '2'), grouped('b', 'Walls'), grouped('c', '1')];
    const bands = groupBands(rows);
    expect(bands).toEqual({ '2': 0, Walls: 1, '1': 2 });
    expect(sortByPaintOrder(rows, bands).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('reorderGroups (issue #400)', () => {
  it('moves a group up, renumbering every group in one pass', () => {
    const groups = ['Walls', 'Slab', 'Roof'];
    expect(reorderGroups(groups, 'Roof', 'Walls', 'before')).toEqual({
      Roof: 0,
      Walls: 1,
      Slab: 2,
    });
  });

  it('drops the dragged group out before resolving the target index', () => {
    // Dragging downward is where splicing into the ORIGINAL list silently
    // no-ops: with Walls still present, index 1 is Slab's own slot and the
    // group lands back where it started. Removing it first makes the move real.
    const groups = ['Walls', 'Slab', 'Roof'];
    expect(reorderGroups(groups, 'Walls', 'Slab', 'after')).toEqual({
      Slab: 0,
      Walls: 1,
      Roof: 2,
    });
  });

  it('reaches the slot after the last group', () => {
    // Same defect as issue #392 for measurement rows: hardcoding 'before' makes
    // the slot past the final group unaddressable.
    const groups = ['Walls', 'Slab', 'Roof'];
    expect(reorderGroups(groups, 'Walls', 'Roof', 'after')).toEqual({
      Slab: 0,
      Roof: 1,
      Walls: 2,
    });
  });

  it('bands sequentially from zero so groupBands cannot re-derive above the result', () => {
    // The band map this returns is fed straight back into groupBands as the
    // explicit map. Sequential bands over every displayed group are what stop
    // an untouched group being re-derived above the one the user just moved.
    const groups = ['A', 'B', 'C'];
    const bands = reorderGroups(groups, 'C', 'B', 'before')!;
    expect(bands).toEqual({ A: 0, C: 1, B: 2 });
    const rows = [grouped('a', 'A'), grouped('b', 'B'), grouped('c', 'C')];
    expect(groupBands(rows, bands)).toEqual(bands);
  });

  it('returns null for a no-op drop so a document-wide write is skipped', () => {
    // Every measurement carries the band, so a write costs one PATCH per row.
    // A drop that changes nothing must not pay that.
    const groups = ['Walls', 'Slab', 'Roof'];
    expect(reorderGroups(groups, 'Walls', 'Walls', 'before')).toBeNull();
    expect(reorderGroups(groups, 'Walls', 'Slab', 'before')).toBeNull();
    expect(reorderGroups(groups, 'Slab', 'Walls', 'after')).toBeNull();
    expect(reorderGroups(groups, 'Walls', 'Nope', 'before')).toBeNull();
    expect(reorderGroups(groups, 'Nope', 'Walls', 'before')).toBeNull();
  });
});
