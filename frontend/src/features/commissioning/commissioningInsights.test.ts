// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A system nobody has written checks for is not a system that is failing. If
// it landed in the red bucket at 0 percent, the readiness chart would tell a
// site manager to chase work that does not exist yet.
import { describe, it, expect } from 'vitest';
import { buildCommissioningInsights } from './commissioningInsights';
import type { CxSystem } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

function readiness(over: Record<string, unknown> = {}) {
  return {
    functional_total: 10,
    functional_passed: 7,
    functional_failed: 1,
    functional_pending: 2,
    functional_na: 0,
    applicable: 10,
    readiness_pct: 70,
    readiness_level: 'amber',
    defined: true,
    ...over,
  };
}

function system(over: Partial<CxSystem>): CxSystem {
  return {
    id: 's1',
    project_id: 'pr1',
    name: 'AHU-01 Air handling unit',
    system_type: 'hvac',
    tag: null,
    location: 'Level 2 plant room',
    description: null,
    status: 'in_progress',
    commissioned_at: null,
    commissioned_by: null,
    created_by: null,
    metadata: {},
    readiness: readiness(),
    ...over,
  } as CxSystem;
}

function row(s: CxSystem) {
  return buildCommissioningInsights([s], t).datasets[0]?.rows[0];
}

describe('buildCommissioningInsights', () => {
  it('reports the backend readiness percentage on the 0..100 scale the chart expects', () => {
    expect(row(system({ readiness: readiness({ readiness_pct: 70 }) as never }))?.pct).toBe(70);
  });

  it('buckets a system with no checks defined separately instead of scoring it red', () => {
    const r = row(system({ readiness: readiness({ defined: false }) as never }));
    expect(r?.readiness).toBe('No checks defined');
  });

  it('buckets a system with no readiness payload the same way', () => {
    expect(row(system({ readiness: null }))?.readiness).toBe('No checks defined');
  });

  it('names a system with no location rather than leaving the bar blank', () => {
    expect(row(system({ location: null }))?.location).toBe('No location');
  });

  it('marks a commissioned system as commissioned', () => {
    expect(row(system({ status: 'commissioned' }))?.commissioned).toBe(1);
    expect(row(system({ status: 'in_progress' }))?.commissioned).toBe(0);
  });

  it('draws nothing at all on an empty project', () => {
    expect(buildCommissioningInsights([], t).datasets[0]?.rows).toHaveLength(0);
    expect(buildCommissioningInsights([system({})], t).datasets[0]?.rows).toHaveLength(1);
  });

  it('exposes no currency-formatted measure, because a system carries no money', () => {
    const ds = buildCommissioningInsights([], t).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
  });
});
