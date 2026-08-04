// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect } from 'vitest';
import { computeExtents } from '../viewport';
import type { DxfEntity } from '../../api';

/**
 * The fixtures mirror the synthetic DXF corpus built for issue #426, so the
 * numbers here and the numbers the real parser produces are the same numbers.
 * Every file shares a closed 10 x 10 rectangle at the origin as its geometry.
 */
const rect: DxfEntity = {
  id: 'r',
  type: 'LWPOLYLINE',
  layer: '0',
  color: 7,
  closed: true,
  vertices: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

function textAt(x: number, y: number, height: number, str: string, rotation?: number): DxfEntity {
  return {
    id: `t-${x}-${y}`,
    type: 'TEXT',
    layer: 'ANNOT',
    color: 7,
    start: { x, y },
    text: str,
    height,
    rotation,
  };
}

describe('computeExtents', () => {
  it('falls back to a unit box for an empty drawing', () => {
    expect(computeExtents([])).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });

  it('boxes geometry exactly (corpus 01_baseline)', () => {
    expect(computeExtents([rect])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('keeps a sane label inside the box (corpus 08_mtext)', () => {
    // 11 characters at h=2.5 from (1,1) really do occupy 16.5 units, so the
    // content box genuinely is 17.5 x 10. Fitting to the rectangle alone
    // would clip the label on load — this is the regression guard, not a bug.
    const box = computeExtents([rect, textAt(1, 1, 2.5, 'ROOM 101 WC')]);
    expect(box.maxX).toBeCloseTo(17.5);
    expect(box.maxY).toBeCloseTo(10);
  });

  it('stops an oversized label squeezing out the geometry (corpus 06_text_large)', () => {
    // h=1000 next to a 10-unit rectangle is authoring noise. The estimate is
    // capped at the drawing's own span, so it contributes 10*4*0.6 = 24
    // units rather than 1000*4*0.6 = 2400.
    const box = computeExtents([rect, textAt(1, 1, 1000, 'HUGE')]);
    expect(box.maxX).toBeCloseTo(25);
    expect(box.maxY).toBeCloseTo(11);
  });

  it('leaves a genuinely huge drawing alone (corpus 10_far_from_origin)', () => {
    // The control: 500001 x 500000 with no text at all. The text branch
    // cannot fire here, so no bound on it can mis-frame this file.
    const far: DxfEntity[] = [
      rect,
      {
        id: 'l',
        type: 'LINE',
        layer: '0',
        color: 7,
        start: { x: 500000, y: 500000 },
        end: { x: 500001, y: 500000 },
      },
    ];
    expect(computeExtents(far)).toEqual({ minX: 0, minY: 0, maxX: 500001, maxY: 500000 });
  });

  it('expands along the text rotation instead of always +X', () => {
    // A half-turn string runs to the LEFT of its insertion point; expanding
    // +X only pushes the box the wrong way and clips the string.
    const box = computeExtents([rect, textAt(5, 5, 2.5, 'ABCD', Math.PI)]);
    expect(box.minX).toBeCloseTo(-1); // 5 - 2.5*4*0.6
    expect(box.minY).toBeCloseTo(0); // rectangle still owns the bottom edge
  });

  it('covers the lines an MTEXT stacks below its insertion point', () => {
    // The renderer splits on newlines and steps DOWN by 1.25 * height per
    // line, so the width is the longest line and the box reaches below.
    const box = computeExtents([rect, textAt(1, 1, 2.5, 'LINE1\nLINE2\nLINE3')]);
    expect(box.maxX).toBeCloseTo(10); // longest line is 5 chars, rect wins
    expect(box.minY).toBeCloseTo(-5.25); // 1 - 2 * 1.25 * 2.5
  });

  it('does not let a stray note widen the span that is meant to bound it', () => {
    // The note is parked at the origin, far from the geometry. Its anchor is
    // in the box - the frame should reach it - but if the cap were read off
    // that same box the note would license a 510-unit glyph and push maxX out
    // to 3060. Measuring the cap over geometry alone keeps it at 10.
    const away: DxfEntity = {
      ...rect,
      vertices: rect.vertices!.map((v) => ({ x: v.x + 500, y: v.y + 500 })),
    };
    const box = computeExtents([away, textAt(0, 0, 1000, 'STRAY NOTE')]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 510, maxY: 510 });
  });

  it('frames a text-only drawing, which has no span to cap against', () => {
    const box = computeExtents([textAt(0, 0, 1000, 'HUGE')]);
    expect(box.maxX).toBeCloseTo(2400);
    expect(box.maxY).toBeCloseTo(1000);
  });

  it('still covers circles, ellipses and line endpoints', () => {
    const box = computeExtents([
      { id: 'c', type: 'CIRCLE', layer: '0', color: 7, start: { x: 0, y: 0 }, radius: 4 },
      {
        id: 'e',
        type: 'ELLIPSE',
        layer: '0',
        color: 7,
        start: { x: 20, y: 0 },
        major_radius: 6,
        minor_radius: 2,
      },
    ]);
    expect(box).toEqual({ minX: -4, minY: -6, maxX: 26, maxY: 6 });
  });
});
