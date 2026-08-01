// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Standing guard: the benchmark module must never claim a number of projects.
 *
 * It used to. Every cell carried a sampleSize built by multiplying two constant
 * tables, the module rendered it as "about N projects", and the confidence
 * score was partly derived from it. Nothing was ever counted. A fabricated
 * count is worse than no count, because a reader treats it as evidence and
 * prices against it.
 *
 * These tests fail if the count comes back, and they pin the confidence
 * thresholds that had to be rebalanced once the sample term was removed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BENCHMARKS, deriveConfidence } from './data/benchmarks';

const here = dirname(fileURLToPath(import.meta.url));

describe('the benchmark data states no project count', () => {
  it('exposes no sample size on any cell', () => {
    const offenders: string[] = [];
    for (const [region, byType] of Object.entries(BENCHMARKS)) {
      for (const [type, range] of Object.entries(byType)) {
        for (const key of Object.keys(range as object)) {
          if (/sample|count|projects/i.test(key)) offenders.push(`${region}.${type}.${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the invented sample tables out of the source', () => {
    const src = readFileSync(join(here, 'data', 'benchmarks.ts'), 'utf8');
    expect(src).not.toMatch(/SAMPLE_BASE|SAMPLE_REGION_FACTOR/);
    expect(src).not.toMatch(/sampleSize/);
  });

  it('does not render a project count in the module', () => {
    const src = readFileSync(join(here, 'BenchmarkModule.tsx'), 'utf8');
    expect(src).not.toMatch(/benchmarks\.sample_count|benchmarks\.sample_size/);
  });
});

describe('confidence rests only on what we actually hold', () => {
  const thisYear = new Date().getFullYear();

  it('is high when the source is recent and the band is tight', () => {
    expect(deriveConfidence(thisYear - 1, 1.0)).toBe('high');
  });

  it('is low when the source is dated and the band is wide', () => {
    expect(deriveConfidence(thisYear - 6, 2.5)).toBe('low');
  });

  it('is medium when one signal is good and the other is not', () => {
    expect(deriveConfidence(thisYear - 1, 2.5)).toBe('medium');
    expect(deriveConfidence(thisYear - 6, 1.0)).toBe('medium');
  });

  it('caps at medium when no spread is available', () => {
    // A cell we can only date must not reach high on recency alone.
    expect(deriveConfidence(thisYear, undefined)).toBe('medium');
  });

  it('takes two arguments, so a resurrected sample size cannot slip back in', () => {
    expect(deriveConfidence.length).toBe(2);
  });
});
