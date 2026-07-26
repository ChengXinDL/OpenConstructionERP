// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { LARGE_TILESET, toTileInfo } from './__fixtures__/largeTileset';
import {
  orderTilesForStreaming,
  orderTilesByGeometryMass,
  orderTilesByViewport,
  tileCenterInViewerSpace,
  type CameraPose,
} from './tilePriority';
import type { TileInfo } from './tileTypes';

function mkTile(overrides: Partial<TileInfo> = {}): TileInfo {
  return {
    id: 't',
    hash: 'h',
    bbox: [0, 0, 0, 1, 1, 1],
    center: [0, 0, 0],
    radius: 1,
    node_count: 1,
    byte_size: 100,
    nodes: [],
    ...overrides,
  };
}

/** Compact view of the result for order assertions. */
function ids(tiles: TileInfo[]): string[] {
  return tiles.map((t) => t.id);
}

describe('orderTilesForStreaming', () => {
  it('returns an empty array unchanged', () => {
    expect(orderTilesForStreaming([])).toEqual([]);
  });

  it('orders by node_count descending when the payloads are equal', () => {
    const out = orderTilesForStreaming([
      mkTile({ id: 'small', node_count: 5 }),
      mkTile({ id: 'big', node_count: 500 }),
      mkTile({ id: 'mid', node_count: 50 }),
    ]);
    expect(ids(out)).toEqual(['big', 'mid', 'small']);
  });

  it('prefers the cheaper tile when two carry the same geometry', () => {
    // Same meshes for a ninth of the bytes: it puts the same amount of building
    // on screen far sooner, so it must go first.
    const out = orderTilesForStreaming([
      mkTile({ id: 'heavy', node_count: 10, byte_size: 9_000 }),
      mkTile({ id: 'light', node_count: 10, byte_size: 1_000 }),
    ]);
    expect(ids(out)).toEqual(['light', 'heavy']);
  });

  it('prefers a small dense tile over a huge tile with more total geometry', () => {
    // The regression this ordering exists to prevent: a 6 MB tile used to be
    // fetched first purely because it held the most meshes, so nothing at all
    // was drawn until megabytes had landed.
    const out = orderTilesForStreaming([
      mkTile({ id: 'bulky', node_count: 994, byte_size: 6_460_000 }),
      mkTile({ id: 'quick', node_count: 40, byte_size: 10_000 }),
    ]);
    expect(ids(out)).toEqual(['quick', 'bulky']);
  });

  it('treats geometry with no recorded payload as free rather than as NaN', () => {
    const out = orderTilesForStreaming([
      mkTile({ id: 'sized', node_count: 100, byte_size: 1_000 }),
      mkTile({ id: 'free', node_count: 1, byte_size: 0 }),
      mkTile({ id: 'empty', node_count: 0, byte_size: 0 }),
    ]);
    expect(ids(out)).toEqual(['free', 'sized', 'empty']);
  });

  it('breaks a node+size tie by going ground-up (lower center Z first)', () => {
    const out = orderTilesForStreaming([
      mkTile({ id: 'roof', node_count: 10, byte_size: 500, center: [0, 0, 30] }),
      mkTile({ id: 'base', node_count: 10, byte_size: 500, center: [0, 0, 0] }),
      mkTile({ id: 'mid', node_count: 10, byte_size: 500, center: [0, 0, 12] }),
    ]);
    expect(ids(out)).toEqual(['base', 'mid', 'roof']);
  });

  it('is stable: full ties keep the original manifest order', () => {
    const out = orderTilesForStreaming([
      mkTile({ id: 'a' }),
      mkTile({ id: 'b' }),
      mkTile({ id: 'c' }),
    ]);
    expect(ids(out)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [mkTile({ id: 'x', node_count: 1 }), mkTile({ id: 'y', node_count: 99 })];
    const snapshot = ids(input);
    orderTilesForStreaming(input);
    expect(ids(input)).toEqual(snapshot);
  });

  it('tolerates malformed tiles (missing/NaN fields) without throwing', () => {
    const out = orderTilesForStreaming([
      mkTile({ id: 'ok', node_count: 3 }),
      // node_count undefined -> treated as 0, sinks to the bottom.
      mkTile({ id: 'bad', node_count: undefined as unknown as number }),
      mkTile({ id: 'nan', node_count: Number.NaN, byte_size: Number.NaN }),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]?.id).toBe('ok');
    // The two zero-mass tiles keep their relative manifest order (stable).
    expect(ids(out).slice(1)).toEqual(['bad', 'nan']);
  });

  it('tolerates a missing center array in the ground-up tie-break', () => {
    const out = orderTilesForStreaming([
      mkTile({ id: 'hi', node_count: 4, byte_size: 200, center: [0, 0, 9] }),
      mkTile({
        id: 'nocenter',
        node_count: 4,
        byte_size: 200,
        center: undefined as unknown as number[],
      }),
    ]);
    // 'nocenter' is treated as height 0, so it sorts below the ground.
    expect(ids(out)).toEqual(['nocenter', 'hi']);
  });

  it('orders a realistic mix top to bottom by the full comparator', () => {
    // Densities: floor1 / floor2 = 0.008, trim = 0.0067, core = 0.0022. The two
    // floors tie on density and mass, so the ground-up rule puts floor1 first.
    const out = orderTilesForStreaming([
      mkTile({ id: 'trim', node_count: 2, byte_size: 300, center: [0, 0, 5] }),
      mkTile({ id: 'core', node_count: 200, byte_size: 90_000, center: [0, 0, 10] }),
      mkTile({ id: 'floor2', node_count: 40, byte_size: 5_000, center: [0, 0, 8] }),
      mkTile({ id: 'floor1', node_count: 40, byte_size: 5_000, center: [0, 0, 3] }),
    ]);
    expect(ids(out)).toEqual(['floor1', 'floor2', 'trim', 'core']);
  });
});

/**
 * Regression gate built from a real baked tileset rather than synthetic tiles.
 * These numbers are the reason the ordering changed, so they are asserted
 * directly: if someone reverts to ranking by geometry mass, the first-paint
 * assertions below fail loudly instead of the regression going unnoticed.
 */
describe('orderTilesForStreaming on a real 80-tile building', () => {
  /** Mirrors the streamer's default `fetchConcurrency ?? 6` in tileStreamer. */
  const CONCURRENCY = 6;

  const tiles: TileInfo[] = LARGE_TILESET.map(toTileInfo);

  /** Bytes that must land before the first tile can possibly be revealed: with
   *  N downloads in flight, the earliest reveal is the smallest of the first N. */
  function bytesToFirstPaint(order: TileInfo[]): number {
    return Math.min(...order.slice(0, CONCURRENCY).map((t) => t.byte_size));
  }

  /** Share of the model's meshes drawn once `budget` bytes have been fetched. */
  function drawnAfter(order: TileInfo[], budget: number): number {
    const totalNodes = tiles.reduce((sum, t) => sum + t.node_count, 0);
    let bytes = 0;
    let nodes = 0;
    for (const tile of order) {
      if (bytes + tile.byte_size > budget) break;
      bytes += tile.byte_size;
      nodes += tile.node_count;
    }
    return nodes / totalNodes;
  }

  it('covers every tile exactly once', () => {
    const out = orderTilesForStreaming(tiles);
    expect(out).toHaveLength(tiles.length);
    expect(new Set(out.map((t) => t.id)).size).toBe(tiles.length);
  });

  it('starts painting after kilobytes, not megabytes', () => {
    const out = orderTilesForStreaming(tiles);
    // Ranking by geometry mass needed ~5.2 MB here. Hold the line well under
    // 100 KB so a regression cannot creep back in unnoticed.
    expect(bytesToFirstPaint(out)).toBeLessThan(100 * 1024);
  });

  it('never fetches less of the building per byte than geometry-mass order', () => {
    const out = orderTilesForStreaming(tiles);
    const byMass = orderTilesByGeometryMass(tiles);
    for (const budgetMb of [1, 10, 50, 100, 150]) {
      const budget = budgetMb * 1024 * 1024;
      expect(drawnAfter(out, budget)).toBeGreaterThanOrEqual(drawnAfter(byMass, budget));
    }
  });

  it('draws a majority of the model within half the total payload', () => {
    // 204 MB of tiles; by 100 MB the measured figure is ~67% against ~47% for
    // geometry-mass order.
    const out = orderTilesForStreaming(tiles);
    expect(drawnAfter(out, 100 * 1024 * 1024)).toBeGreaterThan(0.6);
  });

  it('does not pay for the fast first paint with a longer tail', () => {
    // The trade this ordering could have made and must not: buying an early
    // first pixel by deferring bulk geometry, so the model takes noticeably
    // longer to finish. Fully loaded means every tile fetched, so the total is
    // identical by definition; what could regress is the approach to complete.
    // Assert the late curve too, not just the early one.
    const out = orderTilesForStreaming(tiles);
    const byMass = orderTilesByGeometryMass(tiles);
    const totalBytes = tiles.reduce((sum, t) => sum + t.byte_size, 0);

    for (const fraction of [0.75, 0.9, 0.95]) {
      expect(drawnAfter(out, totalBytes * fraction)).toBeGreaterThanOrEqual(
        drawnAfter(byMass, totalBytes * fraction),
      );
    }
    // Every tile is still scheduled, so the model does reach 100%.
    expect(drawnAfter(out, totalBytes)).toBeCloseTo(1, 5);
  });
});

describe('tileCenterInViewerSpace', () => {
  it('applies the viewer -90deg X rotation: (x, y, z) -> (x, z, -y)', () => {
    expect(tileCenterInViewerSpace(mkTile({ center: [1, 2, 3] }))).toEqual([1, 3, -2]);
  });

  it('treats a missing / malformed centre as the origin', () => {
    expect(
      tileCenterInViewerSpace(mkTile({ center: undefined as unknown as number[] })),
    ).toEqual([0, 0, 0]);
    expect(tileCenterInViewerSpace(mkTile({ center: [Number.NaN, 1, 2] }))).toEqual([0, 2, -1]);
  });
});

describe('orderTilesByViewport', () => {
  it('orders nearest-to-target first (in viewer space)', () => {
    // target at origin; centres map (x,y,z)->(x,z,-y), so distance is driven
    // by the source Z here: near=1, mid=3, far=10.
    const pose: CameraPose = { position: [100, 100, 100], target: [0, 0, 0] };
    const out = orderTilesByViewport(
      [
        mkTile({ id: 'far', center: [0, 0, 10] }),
        mkTile({ id: 'near', center: [0, 0, 1] }),
        mkTile({ id: 'mid', center: [0, 0, 3] }),
      ],
      pose,
    );
    expect(ids(out)).toEqual(['near', 'mid', 'far']);
  });

  it('ranks against the target, not the eye position', () => {
    // Eye sits on top of 'far', but the target is next to 'near' - the target
    // must win so we load what the user is looking at, not where they stand.
    const pose: CameraPose = { position: [0, 10, 0], target: [0, 1, 0] };
    const out = orderTilesByViewport(
      [
        mkTile({ id: 'far', center: [0, 0, 10] }), // viewer [0,10,0] - under the eye
        mkTile({ id: 'near', center: [0, 0, 1] }), // viewer [0,1,0]  - at the target
      ],
      pose,
    );
    expect(ids(out)).toEqual(['near', 'far']);
  });

  it('falls back to the eye position when no target is given', () => {
    const pose: CameraPose = { position: [0, 1, 0] };
    const out = orderTilesByViewport(
      [
        mkTile({ id: 'far', center: [0, 0, 10] }),
        mkTile({ id: 'near', center: [0, 0, 1] }),
      ],
      pose,
    );
    expect(ids(out)).toEqual(['near', 'far']);
  });

  it('breaks an equidistant tie by geometry mass (node_count desc)', () => {
    const pose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0] };
    const out = orderTilesByViewport(
      [
        mkTile({ id: 'light', center: [0, 0, 5], node_count: 3 }),
        mkTile({ id: 'heavy', center: [0, 0, 5], node_count: 300 }),
      ],
      pose,
    );
    expect(ids(out)).toEqual(['heavy', 'light']);
  });

  it('does not mutate the input array', () => {
    const pose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0] };
    const input = [
      mkTile({ id: 'a', center: [0, 0, 9] }),
      mkTile({ id: 'b', center: [0, 0, 1] }),
    ];
    const snapshot = ids(input);
    orderTilesByViewport(input, pose);
    expect(ids(input)).toEqual(snapshot);
  });
});
