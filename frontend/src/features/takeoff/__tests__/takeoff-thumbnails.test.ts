/**
 * Pure tests for the page-thumbnails sidebar helpers: the render-scale maths,
 * the nearest-first render ordering and the LRU cache cap. These pin the
 * behaviour the viewer relies on so a refactor of the (large) viewer module
 * cannot silently change which pages render first or how the thumbnail cache
 * is bounded on a large document.
 */
import { describe, it, expect } from 'vitest';
import {
  THUMB_MAX_WIDTH,
  THUMB_CACHE_MAX,
  computeThumbScale,
  pagesNearestFirst,
  capThumbCache,
  countMeasurementsByPage,
} from '@/features/takeoff/lib/takeoff-thumbnails';

describe('computeThumbScale', () => {
  it('scales a page down to about the target width', () => {
    // A 600pt-wide page at target 120px -> scale 0.2 (600 * 0.2 = 120).
    expect(computeThumbScale(600, 120)).toBeCloseTo(0.2, 6);
    expect(computeThumbScale(1200, THUMB_MAX_WIDTH)).toBeCloseTo(0.1, 6);
  });

  it('falls back for a non-positive / non-finite page width', () => {
    expect(computeThumbScale(0, 120)).toBe(0.2);
    expect(computeThumbScale(-5, 120)).toBe(0.2);
    expect(computeThumbScale(Number.NaN, 120)).toBe(0.2);
  });

  it('falls back for a bad target width', () => {
    expect(computeThumbScale(600, 0)).toBe(0.2);
    expect(computeThumbScale(600, Number.POSITIVE_INFINITY)).toBe(0.2);
  });
});

describe('pagesNearestFirst', () => {
  it('orders the current page first, then fans out (hi before lo)', () => {
    expect(pagesNearestFirst(5, 9)).toEqual([5, 6, 4, 7, 3, 8, 2, 9, 1]);
  });

  it('is always a permutation of 1..total', () => {
    const order = pagesNearestFirst(3, 7);
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(order).toHaveLength(7);
  });

  it('handles the current page at an edge', () => {
    expect(pagesNearestFirst(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pagesNearestFirst(4, 4)).toEqual([4, 3, 2, 1]);
  });

  it('single-page and degenerate inputs', () => {
    expect(pagesNearestFirst(1, 1)).toEqual([1]);
    expect(pagesNearestFirst(1, 0)).toEqual([]);
    expect(pagesNearestFirst(99, 3)).toEqual([3, 2, 1]); // current clamped to total
    expect(pagesNearestFirst(0, 3)).toEqual([1, 2, 3]); // current clamped to 1
  });
});

describe('capThumbCache', () => {
  it('returns the same reference when within the cap (no allocation)', () => {
    const thumbs = { 1: 'a', 2: 'b' };
    expect(capThumbCache(thumbs, 1, 60)).toBe(thumbs);
  });

  it('keeps the pages nearest the current one and drops the far ones', () => {
    const thumbs: Record<number, string> = {};
    for (let p = 1; p <= 10; p++) thumbs[p] = `p${p}`;
    const capped = capThumbCache(thumbs, 5, 3);
    const kept = Object.keys(capped)
      .map(Number)
      .sort((a, b) => a - b);
    // Nearest 3 to page 5: 4, 5, 6 (distance 1, 0, 1). Tie at distance 1
    // keeps the lower page, so 4 wins over 6 -> but we keep 3 nearest:
    // distances {5:0, 4:1, 6:1} -> {5,4,6}.
    expect(kept).toEqual([4, 5, 6]);
    expect(capped[5]).toBe('p5');
  });

  it('does not mutate the input', () => {
    const thumbs: Record<number, string> = {};
    for (let p = 1; p <= 5; p++) thumbs[p] = `p${p}`;
    const before = { ...thumbs };
    capThumbCache(thumbs, 1, 2);
    expect(thumbs).toEqual(before);
  });

  it('defaults to THUMB_CACHE_MAX', () => {
    const thumbs: Record<number, string> = {};
    for (let p = 1; p <= THUMB_CACHE_MAX + 5; p++) thumbs[p] = `p${p}`;
    const capped = capThumbCache(thumbs, 1);
    expect(Object.keys(capped)).toHaveLength(THUMB_CACHE_MAX);
  });
});

describe('countMeasurementsByPage', () => {
  it('counts per 1-indexed page, omitting empty pages', () => {
    const counts = countMeasurementsByPage([
      { page: 1 },
      { page: 1 },
      { page: 3 },
    ]);
    expect(counts).toEqual({ 1: 2, 3: 1 });
    expect(counts[2]).toBeUndefined();
  });

  it('ignores invalid page numbers', () => {
    const counts = countMeasurementsByPage([
      { page: 0 },
      { page: -2 },
      { page: Number.NaN },
      { page: 2 },
    ]);
    expect(counts).toEqual({ 2: 1 });
  });

  it('empty list -> empty map', () => {
    expect(countMeasurementsByPage([])).toEqual({});
  });
});
