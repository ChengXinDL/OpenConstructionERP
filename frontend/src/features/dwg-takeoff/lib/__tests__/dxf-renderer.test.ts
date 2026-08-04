// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect } from 'vitest';
import { textFontSize, renderText, renderInsert, renderEntities } from '../dxf-renderer';
import { groupBlockDefinitions } from '../blocks';
import type { ViewportState } from '../viewport';
import type { DxfEntity } from '../../api';

/**
 * Minimal recording stand-in for CanvasRenderingContext2D. jsdom has no 2D
 * context, and none of these assertions need real rasterisation — they only
 * need to know which drawing calls were issued and with what coordinates.
 */
function stubCtx(): { ctx: CanvasRenderingContext2D; calls: { op: string; args: unknown[] }[] } {
  const calls: { op: string; args: unknown[] }[] = [];
  const rec =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };
  const ctx = {
    font: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    scale: rec('scale'),
    fillText: rec('fillText'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const vp = (scale: number): ViewportState => ({ offsetX: 0, offsetY: 0, scale });

function text(height: number | undefined, str = 'ROOM 101'): DxfEntity {
  return {
    id: 't',
    type: 'TEXT',
    layer: 'ANNOT',
    color: 7,
    start: { x: 0, y: 0 },
    text: str,
    height,
  };
}

function insert(over: Partial<DxfEntity> = {}): DxfEntity {
  return {
    id: 'i',
    type: 'INSERT',
    layer: 'BLOCKS',
    color: 7,
    start: { x: 0, y: 0 },
    block_name: 'DOOR-900',
    ...over,
  };
}

function pathPoints(calls: { op: string; args: unknown[] }[]): [number, number][] {
  return calls
    .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
    .map((c) => [c.args[0] as number, c.args[1] as number]);
}

describe('textFontSize', () => {
  // Annotation is drawn to a readable band, not to true scale. That is sound
  // only because `computeExtents` fits to geometry alone - the clamp and the
  // fit box no longer depend on each other, so neither can drag the other.
  it('tracks the viewport scale inside the readable band', () => {
    const e = text(2.5);
    expect(textFontSize(e, vp(4))).toBeCloseTo(10);
    expect(textFontSize(e, vp(10))).toBeCloseTo(25);
    expect(textFontSize(e, vp(20))).toBeCloseTo(50);
  });

  it('holds a fitted plan’s annotation at the 8px floor', () => {
    // A 100 m plan fitted into a 1877 px canvas puts vp.scale near 0.019, so
    // 2.5 mm annotation is 0.0475 px - invisible. The floor is what keeps a
    // label readable at the zoom the drawing is first shown at.
    expect(textFontSize(text(2.5), vp(0.019))).toBe(8);
  });

  it('holds a pathological glyph at the 72px ceiling', () => {
    // The 06_text_large case, and the reason the ceiling has to exist: at the
    // fitted scale this glyph is 56800 px, which paints over the whole canvas
    // and hides the geometry the user opened the file to measure.
    expect(textFontSize(text(1000), vp(56.8))).toBe(72);
    expect(textFontSize(text(2.5), vp(1000))).toBe(72);
  });

  it('is monotonic in the scale and never leaves the band', () => {
    const e = text(2.5);
    let previous = 0;
    for (const s of [0.001, 0.01, 0.1, 1, 10, 100, 1000]) {
      const px = textFontSize(e, vp(s));
      expect(px).toBeGreaterThanOrEqual(8);
      expect(px).toBeLessThanOrEqual(72);
      expect(px).toBeGreaterThanOrEqual(previous);
      previous = px;
    }
  });

  it('defaults a missing height to 2.5 world units', () => {
    expect(textFontSize(text(undefined), vp(4))).toBeCloseTo(10);
  });
});

describe('renderText', () => {
  it('draws a string the fitted view would otherwise render sub-pixel', () => {
    // Nothing is skipped for being small any more, because nothing can be
    // small any more - the floor lifts it to 8 px first.
    const { ctx, calls } = stubCtx();
    renderText(ctx, text(2.5), vp(0.1)); // 0.25 px unclamped, 8 px drawn
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(1);
    expect(ctx.font).toContain('8px');
  });

  it('draws every line of an MTEXT', () => {
    const { ctx, calls } = stubCtx();
    renderText(ctx, text(2.5, 'LINE1\nLINE2\nLINE3'), vp(10));
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(3);
  });

  it('steps lines by 1.25 of the clamped size, not the authored one', () => {
    // The line step follows what is drawn. If it followed the authored height
    // the lines of a clamped MTEXT would fly apart or collapse together.
    const { ctx, calls } = stubCtx();
    renderText(ctx, text(1000, 'A\nB'), vp(1)); // 1000 px unclamped, 72 px drawn
    const ys = calls.filter((c) => c.op === 'fillText').map((c) => c.args[2] as number);
    expect(ys).toHaveLength(2);
    expect(ys[1]! - ys[0]!).toBeCloseTo(72 * 1.25);
  });
});

describe('renderInsert marker', () => {
  it('draws the unrotated unit-scale marker as the classic 5 px diamond', () => {
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert(), vp(1));
    expect(pathPoints(calls)).toEqual([
      [0, -5],
      [5, 0],
      [0, 5],
      [-5, 0],
    ]);
  });

  it('rotates the marker with the block reference', () => {
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert({ rotation: Math.PI / 2 }), vp(1));
    const pts = pathPoints(calls);
    // A quarter turn moves the leading corner off the vertical axis.
    expect(pts[0]![0]).toBeCloseTo(-5);
    expect(pts[0]![1]).toBeCloseTo(0);
  });

  it('shows a non-uniform x/y scale as a non-uniform marker', () => {
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert({ x_scale: 2, y_scale: 1 }), vp(1));
    const pts = pathPoints(calls);
    expect(pts[0]![1]).toBeCloseTo(-2.5); // vertical half-axis halved
    expect(pts[1]![0]).toBeCloseTo(5); // horizontal half-axis unchanged
  });

  it('keeps a uniformly scaled block at the marker size — the footprint is unknown', () => {
    // x_scale says the block was scaled 50x but not what it was scaled from,
    // so there is no honest world-space footprint to draw.
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert({ x_scale: 50, y_scale: 50 }), vp(1));
    expect(pathPoints(calls)).toEqual([
      [0, -5],
      [5, 0],
      [0, 5],
      [-5, 0],
    ]);
  });

  it('leaves the shared context state as it found it', () => {
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert(), vp(1));
    expect(calls.filter((c) => c.op === 'save')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'restore')).toHaveLength(1);
  });

  it('draws no marker once the definition is available', () => {
    // The marker stands in for geometry the client did not have. When the
    // geometry arrives the caller draws it, and a diamond on top of the door
    // it stands for is worse than either alone.
    const defs = groupBlockDefinitions([
      { id: 'm', type: 'LINE', layer: '0', color: 7, block: 'DOOR-900' },
    ]);
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert(), vp(1), defs);
    expect(calls).toHaveLength(0);
  });

  it('still draws the marker when the named definition is missing', () => {
    const defs = groupBlockDefinitions([
      { id: 'm', type: 'LINE', layer: '0', color: 7, block: 'WINDOW' },
    ]);
    const { ctx, calls } = stubCtx();
    renderInsert(ctx, insert(), vp(1), defs);
    expect(pathPoints(calls)).toHaveLength(4);
  });
});

describe('renderEntities', () => {
  it('draws nothing for an unplaced definition member', () => {
    // Its coordinates are in block space, so drawing it here scatters loose
    // parts across the sheet at coordinates that mean nothing.
    const { ctx, calls } = stubCtx();
    const leaf: DxfEntity = {
      id: 'leaf',
      type: 'LINE',
      layer: '0',
      color: 7,
      block: 'DOOR-900',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    };
    renderEntities(ctx, [leaf], vp(1), new Set(['0']), null, 800, 600);
    expect(calls.filter((c) => c.op === 'lineTo')).toHaveLength(0);
  });

  it('draws an ordinary entity on a visible layer', () => {
    const { ctx, calls } = stubCtx();
    const line: DxfEntity = {
      id: 'l',
      type: 'LINE',
      layer: 'A-WALL',
      color: 7,
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    };
    renderEntities(ctx, [line], vp(1), new Set(['A-WALL']), null, 800, 600);
    expect(calls.filter((c) => c.op === 'lineTo')).toHaveLength(1);
  });
});
