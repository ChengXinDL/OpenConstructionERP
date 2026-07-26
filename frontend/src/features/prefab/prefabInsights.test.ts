// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Two things silently mislead here if they drift: the stage machine's 0..1
// fraction against the panel's 0..100 percent format, and counting an already
// installed unit as late because its target date is in the past.
import { describe, it, expect } from 'vitest';
import { buildPrefabInsights } from './prefabInsights';
import type { PrefabUnit } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

function unit(over: Partial<PrefabUnit>): PrefabUnit {
  return {
    id: 'u1',
    project_id: 'pr1',
    ref: 'POD-101',
    unit_type: 'pod',
    status: 'in_production',
    target_install_date: inDays(14),
    cost_basis: '42000.00',
    completed_fraction: 0.4,
    earned_value: '16800.00',
    ...over,
  } as PrefabUnit;
}

function row(u: PrefabUnit) {
  return buildPrefabInsights([u], 'EUR', t).datasets[0]?.rows[0];
}

describe('buildPrefabInsights', () => {
  it('converts the stage machine fraction to the percent the chart format expects', () => {
    expect(row(unit({ completed_fraction: 0.4 }))?.progress).toBe(40);
    expect(row(unit({ completed_fraction: 1 }))?.progress).toBe(100);
  });

  it('treats a missing fraction as no progress rather than NaN', () => {
    expect(row(unit({ completed_fraction: null }))?.progress).toBe(0);
  });

  it('parses decimal-string money instead of concatenating it into a sum', () => {
    const r = row(unit({ cost_basis: '42000.00', earned_value: '16800.00' }));
    expect(r?.basis).toBe(42000);
    expect(r?.earned).toBe(16800);
  });

  it('does not poison a sum when the API sends no cost link', () => {
    const r = row(unit({ cost_basis: null, earned_value: null }));
    expect(r?.basis).toBe(0);
    expect(r?.earned).toBe(0);
  });

  it('flags an outstanding unit past its target install date', () => {
    expect(row(unit({ target_install_date: inDays(-3) }))?.late).toBe(1);
  });

  it('does not chase a unit that is already installed', () => {
    const r = row(unit({ status: 'installed', target_install_date: inDays(-30) }));
    expect(r?.late).toBe(0);
    expect(r?.installed).toBe(1);
  });

  it('carries the project currency, because prefab money is real', () => {
    const ds = buildPrefabInsights([unit({})], 'GBP', t).datasets[0];
    expect(ds?.currency).toBe('GBP');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(true);
  });
});
