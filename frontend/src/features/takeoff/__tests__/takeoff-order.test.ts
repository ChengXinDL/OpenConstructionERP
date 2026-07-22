// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
import { describe, it, expect } from 'vitest';
import {
  sortByPaintOrder,
  orderKeyForEdge,
  orderKeyBetween,
  orderKeyForDrop,
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
});
