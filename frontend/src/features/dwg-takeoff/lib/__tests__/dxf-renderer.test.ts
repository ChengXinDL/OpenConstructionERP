// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect } from 'vitest';
import { textFontSize, renderText, renderInsert } from '../dxf-renderer';
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
  // Annotation must sit on the same transform as the geometry. The old
  // [8px, 72px] clamp broke that in both directions: below 8/scale world
  // units a glyph stopped shrinking while the geometry kept shrinking, which
  // is what turns a fitted plan into readable labels over a hairline smear.
  it('tracks the viewport scale across three decades', () => {
    const e = text(2.5);
    expect(textFontSize(e, vp(1))).toBeCloseTo(2.5);
    expect(textFontSize(e, vp(10))).toBeCloseTo(25);
    expect(textFontSize(e, vp(100))).toBeCloseTo(250);
  });

  it('keeps shrinking below the old 8px floor', () => {
    // A 100 m plan fitted into a 1877 px canvas puts vp.scale near 0.019, so
    // 2.5 mm annotation wants a twentieth of a pixel. It used to get 8.
    expect(textFontSize(text(2.5), vp(0.019))).toBeCloseTo(0.0475);
  });

  it('keeps growing above the old 72px ceiling', () => {
    expect(textFontSize(text(2.5), vp(1000))).toBeCloseTo(2500);
  });

  it('stays proportional — doubling the scale doubles the glyph', () => {
    const e = text(2.5);
    for (const s of [0.001, 0.01, 0.1, 1, 10, 100]) {
      expect(textFontSize(e, vp(s * 2)) / textFontSize(e, vp(s))).toBeCloseTo(2);
    }
  });

  it('defaults a missing height to 2.5 world units', () => {
    expect(textFontSize(text(undefined), vp(4))).toBeCloseTo(10);
  });
});

describe('renderText legibility floor', () => {
  it('skips a string that would render below half a pixel', () => {
    const { ctx, calls } = stubCtx();
    renderText(ctx, text(2.5), vp(0.1)); // 0.25 px
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(0);
  });

  it('draws a string that reaches the threshold', () => {
    const { ctx, calls } = stubCtx();
    renderText(ctx, text(2.5), vp(0.2)); // exactly 0.5 px
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(1);
  });

  it('draws every line of a legible MTEXT', () => {
    const { ctx, calls } = stubCtx();
    renderText(ctx, text(2.5, 'LINE1\nLINE2\nLINE3'), vp(10));
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(3);
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
});
