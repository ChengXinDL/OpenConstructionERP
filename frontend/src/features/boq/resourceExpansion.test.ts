// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

import { describe, it, expect } from 'vitest';

import type { Position } from './api';
import {
  allResourcesExpanded,
  expandableResourcePositionIds,
  hasExpandableResources,
  resourceExpansionState,
} from './resourceExpansion';

function pos(over: Partial<Position> & { id: string }): Position {
  return {
    id: over.id,
    boq_id: 'b1',
    ordinal: over.ordinal ?? '1',
    description: over.description ?? 'Work',
    unit: over.unit ?? 'm2',
    quantity: over.quantity ?? 1,
    unit_rate: over.unit_rate ?? 1,
    total: over.total ?? 1,
    metadata: over.metadata ?? {},
  } as Position;
}

const res = (quantity: number) => ({ name: 'Cement', unit: 'kg', quantity, rate: 1 });

describe('hasExpandableResources', () => {
  it('is true for a leaf position carrying resources', () => {
    expect(hasExpandableResources(pos({ id: 'p1', metadata: { resources: [res(2)] } }))).toBe(true);
  });

  it('is false without resources', () => {
    expect(hasExpandableResources(pos({ id: 'p1' }))).toBe(false);
    expect(hasExpandableResources(pos({ id: 'p2', metadata: { resources: [] } }))).toBe(false);
  });

  it('is false for a section even when it somehow carries resources', () => {
    // Sections are unit-less group headers and never render a chevron, so
    // expand-all must not count them or the toggle can never reach "all open".
    expect(
      hasExpandableResources(pos({ id: 's1', unit: '', metadata: { resources: [res(1)] } })),
    ).toBe(false);
    expect(
      hasExpandableResources(pos({ id: 's2', unit: 'section', metadata: { resources: [res(1)] } })),
    ).toBe(false);
  });

  it('counts resources with zero quantity, unlike the pricing predicate', () => {
    // A blank resource row is exactly what the user opens the position to fill
    // in. hasContributingResources would say false here; the chevron says true.
    expect(hasExpandableResources(pos({ id: 'p1', metadata: { resources: [res(0)] } }))).toBe(true);
  });

  it('ignores a non-array resources value', () => {
    expect(hasExpandableResources(pos({ id: 'p1', metadata: { resources: 'nonsense' } }))).toBe(
      false,
    );
  });
});

describe('expandableResourcePositionIds', () => {
  it('keeps list order and skips the rest', () => {
    const positions = [
      pos({ id: 'a', metadata: { resources: [res(1)] } }),
      pos({ id: 'sec', unit: '' }),
      pos({ id: 'b' }),
      pos({ id: 'c', metadata: { resources: [res(1), res(2)] } }),
    ];
    expect(expandableResourcePositionIds(positions)).toEqual(['a', 'c']);
  });

  it('is empty for an empty BOQ', () => {
    expect(expandableResourcePositionIds([])).toEqual([]);
  });
});

describe('resourceExpansionState', () => {
  const positions = [
    pos({ id: 'a', metadata: { resources: [res(1)] } }),
    pos({ id: 'b', metadata: { resources: [res(1)] } }),
    pos({ id: 'c' }),
  ];

  it('counts open positions against the expandable set', () => {
    expect(resourceExpansionState(positions, new Set(['a']))).toEqual({
      expandable: 2,
      expanded: 1,
    });
  });

  it('ignores stale ids left over after a refetch', () => {
    // 'gone' was expanded before its position disappeared, and 'c' has no
    // resources. Counting the raw set would report 3 of 2 open and strand the
    // toggle showing "all expanded" over closed rows.
    const state = resourceExpansionState(positions, new Set(['a', 'b', 'c', 'gone']));
    expect(state).toEqual({ expandable: 2, expanded: 2 });
    expect(allResourcesExpanded(state)).toBe(true);
  });
});

describe('allResourcesExpanded', () => {
  it('is false when nothing is expandable', () => {
    expect(allResourcesExpanded({ expandable: 0, expanded: 0 })).toBe(false);
  });

  it('is false while any expandable position is closed', () => {
    expect(allResourcesExpanded({ expandable: 3, expanded: 2 })).toBe(false);
  });

  it('is true only when every expandable position is open', () => {
    expect(allResourcesExpanded({ expandable: 3, expanded: 3 })).toBe(true);
  });
});
