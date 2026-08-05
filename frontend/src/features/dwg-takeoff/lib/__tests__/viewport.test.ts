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

  it('fits an ordinary label to the geometry, not to the label (corpus 08_mtext)', () => {
    // The everyday case, and the one that decides whether a real drawing
    // fills the view. 11 characters at h=2.5 genuinely occupy 16.5 units, so
    // an honest content box is 17.5 x 10 - and fitting to it still renders
    // the drawing 1.75x too small for no benefit the user asked for. The
    // label is drawn, it just does not get a vote on the frame.
    const box = computeExtents([rect, textAt(1, 1, 2.5, 'ROOM 101 WC')]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('is unmoved by an oversized label (corpus 06_text_large)', () => {
    // h=1000 beside a 10-unit rectangle used to inflate the box 240-fold.
    // Capping the contribution only reduced it to 2.5-fold; excluding text
    // removes it. The glyph is still drawn, at the size the drawing asks for -
    // it simply cannot move the frame.
    const box = computeExtents([rect, textAt(1, 1, 1000, 'HUGE')]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('ignores block definition members, which are not placed anywhere', () => {
    // Definition coordinates are in the block's own space. A door leaf drawn
    // 500 units from its block origin is not 500 units from the sheet origin,
    // and letting it into the fit blows the frame out exactly the way an
    // oversized label used to. The page's layout filter usually drops these
    // first, but a drawing with no layouts at all takes a branch that does
    // not, so the rule belongs here where it cannot be bypassed.
    const leaf: DxfEntity = {
      id: 'leaf',
      type: 'LINE',
      layer: '0',
      color: 7,
      block: 'DOOR-900',
      start: { x: 0, y: 0 },
      end: { x: 500, y: 500 },
    };
    expect(computeExtents([rect, leaf])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('gives the same box whatever the text does to it (corpus 05, 06, 07, 08)', () => {
    // The property behind the four cases above, stated once: for a fixed
    // geometry the fit is a constant function of the annotation. Written as a
    // sweep because the corpus files differ only in their text, and this is
    // the invariant that makes all four of them land on the same frame.
    const geometryOnly = computeExtents([rect]);
    const annotations: DxfEntity[][] = [
      [textAt(1, 1, 0.1, 'TINY')],
      [textAt(1, 1, 1000, 'HUGE')],
      [textAt(1, 1, 0.1, 'TINY'), textAt(1, 3, 2.5, 'NORMAL'), textAt(1, 5, 1000, 'HUGE')],
      [textAt(1, 1, 2.5, 'MTEXT LABEL')],
      [textAt(5, 5, 2.5, 'ROTATED', Math.PI)],
      [textAt(1, 1, 2.5, 'LINE1\nLINE2\nLINE3')],
    ];
    for (const texts of annotations) {
      expect(computeExtents([rect, ...texts])).toEqual(geometryOnly);
    }
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

  it('leaves a stray note outside the frame rather than fitting to it', () => {
    // A note parked far from the drawing is an ordinary CAD artifact, and it
    // used to drag the frame across the gap. The accepted cost of fitting to
    // geometry is that such a label sits off-view until the user pans, which
    // is the right trade when the alternative is a drawing 50x too small.
    const away: DxfEntity = {
      ...rect,
      vertices: rect.vertices!.map((v) => ({ x: v.x + 500, y: v.y + 500 })),
    };
    const box = computeExtents([away, textAt(0, 0, 1000, 'STRAY NOTE')]);
    expect(box).toEqual({ minX: 500, minY: 500, maxX: 510, maxY: 510 });
  });

  it('frames a text-only drawing, which has no geometry to fit', () => {
    // The fallback, and the only reason `textExtents` still exists. Without
    // it a drawing made only of annotation would fit to the empty-drawing
    // default and show nothing at all.
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
