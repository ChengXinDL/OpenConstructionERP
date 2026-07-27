/**
 * Pure tests for "find on sheet" text search. The single highest-risk piece
 * of the feature is the pdf.js text-layer coordinate conversion (pdf.js text
 * space is bottom-left / y-up; the takeoff overlay is top-left / y-down), so
 * these assert the placed box against hand-computed coordinates for a known
 * page height, plus the per-item match + snippet behaviour and its v1
 * limitations.
 *
 * Box derivation for the fixtures (page height H, run baseline origin (e, f),
 * advance width w, cap height h):
 *   minX = e,            maxX = e + w
 *   maxY = H - f,        minY = (H - f) - h
 * (see takeoff-textsearch.ts header).
 */
import { describe, it, expect } from 'vitest';
import {
  placeTextItem,
  itemsFromTextContent,
  findMatchesInPage,
  buildSnippet,
  type RawTextContentItem,
  type TextItem,
} from '@/features/takeoff/lib/takeoff-textsearch';

const H = 800; // page height in PDF units for all fixtures

/** A pdf.js-shaped run: baseline origin (e, f), advance w, cap height h. */
function run(str: string, e: number, f: number, w: number, h = 9): RawTextContentItem {
  return { str, transform: [12, 0, 0, 12, e, f], width: w, height: h };
}

describe('placeTextItem (coordinate conversion)', () => {
  it('flips pdf.js bottom-left y into top-left overlay space', () => {
    // Baseline origin (100, 700) on an 800-tall page -> near the TOP of the
    // sheet in top-left space (small y).
    const placed = placeTextItem(run('Living Room', 100, 700, 60), H);
    expect(placed).not.toBeNull();
    expect(placed!.box).toEqual({ minX: 100, minY: 91, maxX: 160, maxY: 100 });
  });

  it('a run near the bottom of the sheet lands at large top-left y', () => {
    // Baseline origin (50, 40): near the bottom in y-up -> large y top-left.
    const placed = placeTextItem(run('SCALE 1:50', 50, 40, 80), H);
    expect(placed!.box).toEqual({ minX: 50, minY: 751, maxX: 130, maxY: 760 });
  });

  it('falls back to the matrix vertical scale when height is 0', () => {
    // Whitespace-ish run pdf.js reports as height 0 -> use |transform[3]| = 12.
    const placed = placeTextItem({ str: 'x', transform: [12, 0, 0, 12, 10, 100], width: 5, height: 0 }, H);
    expect(placed!.box.maxY - placed!.box.minY).toBe(12);
  });

  it('returns null for markers / empty / malformed runs', () => {
    expect(placeTextItem({ type: 'beginMarkedContent' } as RawTextContentItem, H)).toBeNull();
    expect(placeTextItem({ str: '', transform: [1, 0, 0, 1, 0, 0], width: 0 }, H)).toBeNull();
    expect(placeTextItem({ str: 'hi' }, H)).toBeNull(); // no transform
    expect(placeTextItem({ str: 'hi', transform: [1, 0, 0, 1, Number.NaN, 0] }, H)).toBeNull();
  });
});

describe('itemsFromTextContent', () => {
  it('places text runs and skips non-text items', () => {
    const items = itemsFromTextContent(
      [
        run('Room 101', 100, 700, 50),
        { type: 'beginMarkedContent' } as RawTextContentItem,
        run('Room 102', 100, 680, 50),
        { str: '', transform: [1, 0, 0, 1, 0, 0] }, // empty
      ],
      H,
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.str)).toEqual(['Room 101', 'Room 102']);
  });
});

describe('findMatchesInPage', () => {
  const items: TextItem[] = itemsFromTextContent(
    [
      run('Living Room', 100, 700, 60),
      run('Bedroom', 100, 680, 40),
      run('SCALE 1:50', 50, 40, 80),
    ],
    H,
  );

  it('matches case-insensitively and returns the run box', () => {
    const m = findMatchesInPage(items, 'room', 3);
    // "Living Room" and "Bedroom" both contain "room".
    expect(m).toHaveLength(2);
    expect(m[0]!.page).toBe(3);
    expect(m[0]!.box).toEqual({ minX: 100, minY: 91, maxX: 160, maxY: 100 });
    expect(m[1]!.box.minY).toBe(111); // Bedroom: 800-680-9
  });

  it('assigns running indices starting at startIndex', () => {
    const m = findMatchesInPage(items, 'room', 2, 10);
    expect(m.map((x) => x.index)).toEqual([10, 11]);
  });

  it('finds multiple occurrences within one run', () => {
    const one = itemsFromTextContent([run('door to door', 0, 700, 70)], H);
    const m = findMatchesInPage(one, 'door', 1);
    expect(m).toHaveLength(2);
    // Both share the single run box.
    expect(m[0]!.box).toEqual(m[1]!.box);
  });

  it('trims the query and returns nothing for an empty query', () => {
    expect(findMatchesInPage(items, '   ', 1)).toEqual([]);
    expect(findMatchesInPage(items, '', 1)).toEqual([]);
    expect(findMatchesInPage(items, '  scale ', 1)).toHaveLength(1);
  });

  it('v1 limitation: a query spanning two runs is NOT found', () => {
    // pdf.js split "fire rated" across two runs; per-item match misses it.
    const split = itemsFromTextContent(
      [run('fire ', 0, 700, 25), run('rated', 25, 700, 30)],
      H,
    );
    expect(findMatchesInPage(split, 'fire rated', 1)).toEqual([]);
    // Each run on its own is still found.
    expect(findMatchesInPage(split, 'fire', 1)).toHaveLength(1);
    expect(findMatchesInPage(split, 'rated', 1)).toHaveLength(1);
  });
});

describe('buildSnippet', () => {
  it('returns the whole short run untouched', () => {
    expect(buildSnippet('Room 101', 0, 4)).toBe('Room 101');
  });

  it('clips with an ellipsis on a long run and collapses whitespace', () => {
    const long = `${'a '.repeat(40)}TARGET${' b'.repeat(40)}`;
    const s = buildSnippet(long, long.indexOf('TARGET'), 'TARGET'.length);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('TARGET');
    expect(s).not.toContain('  '); // whitespace collapsed
  });
});
