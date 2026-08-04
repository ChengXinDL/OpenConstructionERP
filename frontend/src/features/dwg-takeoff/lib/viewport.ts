// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Viewport math utilities for the DXF canvas viewer.
 *
 * All coordinates follow the convention:
 *   screen = canvas pixel coordinates (top-left origin, Y down)
 *   world  = DXF model-space coordinates (bottom-left origin, Y up)
 */

import type { DxfEntity } from '../api';

export interface ViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface Extents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * World-space bounding box of every entity, used to fit the drawing on load.
 *
 * Geometry is measured first, then annotation is added on top. The split is
 * deliberate: this is a takeoff tool, and a drawing framed around its labels
 * instead of around the thing being measured is the wrong default. Text is
 * still included - a room label really does sit beside its room, and clipping
 * it on load would be its own defect - but it cannot drive the frame on its
 * own. See `textExtents` for the bound.
 */
export function computeExtents(entities: DxfEntity[]): Extents {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // The same box measured over geometry alone. Annotation contributes its
  // anchor to the box - a label is somewhere, and the frame should cover it -
  // but not to the bound below, or a note parked far from the drawing would
  // widen the span that is supposed to be limiting it.
  let geomMinX = Infinity;
  let geomMinY = Infinity;
  let geomMaxX = -Infinity;
  let geomMaxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const expandGeometry = (x: number, y: number) => {
    expand(x, y);
    if (x < geomMinX) geomMinX = x;
    if (y < geomMinY) geomMinY = y;
    if (x > geomMaxX) geomMaxX = x;
    if (y > geomMaxY) geomMaxY = y;
  };

  for (const e of entities) {
    const put = e.type === 'TEXT' ? expand : expandGeometry;
    if (e.start) put(e.start.x, e.start.y);
    if (e.end) put(e.end.x, e.end.y);
    if (e.vertices) {
      for (const v of e.vertices) put(v.x, v.y);
    }
    if (e.start && e.radius) {
      put(e.start.x - e.radius, e.start.y - e.radius);
      put(e.start.x + e.radius, e.start.y + e.radius);
    }
    if (e.type === 'ELLIPSE' && e.start) {
      const r = Math.max(e.major_radius ?? 0, e.minor_radius ?? 0, e.radius ?? 0);
      if (r > 0) {
        put(e.start.x - r, e.start.y - r);
        put(e.start.x + r, e.start.y + r);
      }
    }
  }

  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  // A glyph taller than the drawing itself is authoring noise, not content, so
  // the height an estimate may use is capped at the drawing's own span. One
  // 1000-unit label beside a 10-unit rectangle used to inflate the fit box
  // 240-fold and collapse the geometry to four pixels. A drawing with no
  // geometry to measure, or with all of it on one axis, has no span to cap
  // against, so there the estimate is used as authored.
  const heightCap = isFinite(geomMinX)
    ? Math.min(geomMaxX - geomMinX, geomMaxY - geomMinY) ||
      Math.max(geomMaxX - geomMinX, geomMaxY - geomMinY) ||
      Infinity
    : Infinity;

  for (const e of entities) {
    const box = textExtents(e, heightCap);
    if (box) {
      expand(box.minX, box.minY);
      expand(box.maxX, box.maxY);
    }
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Estimated world-space box of one TEXT/MTEXT entity, or null if it draws
 * nothing. `heightCap` bounds the authored height the estimate may use.
 *
 * The box describes what the renderer will actually put on the canvas rather
 * than what the file claims, because the two have to agree for the fit to
 * mean anything. So: glyph width is the same `0.6 * height` advance estimate
 * the renderer's font produces; multi-line strings are as wide as their
 * longest line and stack *downwards* from the insertion point the way
 * `renderText` draws them; and the box turns with `rotation`, which the
 * renderer applies and this estimate used to ignore - a half-turn string runs
 * to the left of its insertion point, and expanding +X only pushed the frame
 * the wrong way. Justification is ignored here because the renderer ignores
 * it too: both draw from the insertion point.
 */
function textExtents(e: DxfEntity, heightCap: number): Extents | null {
  if (e.type !== 'TEXT' || !e.start || !e.text) return null;
  const h = Math.min(e.height ?? 2.5, heightCap);
  const lines = e.text.split('\n');
  const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
  const width = h * longest * 0.6;
  const up = h;
  const down = (lines.length - 1) * h * 1.25; // matches renderText's line step

  // Advance direction and the perpendicular ascender, in world units.
  const rot = e.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const along of [0, width]) {
    for (const across of [up, -down]) {
      const x = e.start.x + along * cos - across * sin;
      const y = e.start.y + along * sin + across * cos;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Convert screen (canvas) coordinates to DXF world coordinates. */
export function screenToWorld(
  sx: number,
  sy: number,
  vp: ViewportState,
): { x: number; y: number } {
  return {
    x: (sx - vp.offsetX) / vp.scale,
    y: -(sy - vp.offsetY) / vp.scale,
  };
}

/** Convert DXF world coordinates to screen (canvas) coordinates. */
export function worldToScreen(
  wx: number,
  wy: number,
  vp: ViewportState,
): { x: number; y: number } {
  return {
    x: wx * vp.scale + vp.offsetX,
    y: -wy * vp.scale + vp.offsetY,
  };
}

/** Compute a viewport that fits the given extents into the canvas with padding. */
export function zoomToFit(
  extents: Extents,
  canvasWidth: number,
  canvasHeight: number,
  padding = 16,
): ViewportState {
  const dw = extents.maxX - extents.minX || 1;
  const dh = extents.maxY - extents.minY || 1;

  const availW = canvasWidth - padding * 2;
  const availH = canvasHeight - padding * 2;

  const scale = Math.min(availW / dw, availH / dh);

  const cx = (extents.minX + extents.maxX) / 2;
  const cy = (extents.minY + extents.maxY) / 2;

  return {
    offsetX: canvasWidth / 2 - cx * scale,
    offsetY: canvasHeight / 2 + cy * scale,
    scale,
  };
}

/** Apply a zoom factor centered at a screen point. */
export function applyZoom(
  vp: ViewportState,
  factor: number,
  centerX: number,
  centerY: number,
): ViewportState {
  const newScale = vp.scale * factor;
  return {
    scale: newScale,
    offsetX: centerX - (centerX - vp.offsetX) * (newScale / vp.scale),
    offsetY: centerY - (centerY - vp.offsetY) * (newScale / vp.scale),
  };
}

/** Apply a pan delta (in screen pixels). */
export function applyPan(vp: ViewportState, dx: number, dy: number): ViewportState {
  return {
    ...vp,
    offsetX: vp.offsetX + dx,
    offsetY: vp.offsetY + dy,
  };
}
