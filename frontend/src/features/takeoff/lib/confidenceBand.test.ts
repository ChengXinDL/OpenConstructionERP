// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

/** The band a suggestion is shown in must match the one the server used.
 *
 *  The failure this guards against is quiet: a viewer that draws its own cut
 *  points still renders a plausible badge, so a deployment that moved its
 *  thresholds would go on calling a suggestion "high" that the server counts
 *  as medium, and nobody would notice until an accepted proposal turned out
 *  wrong. The edge cases below are all boundary or malformed-input cases,
 *  because those are the ones a percentage-only badge never had to answer.
 */

import { describe, expect, it } from 'vitest';

import {
  confidenceBand,
  countConfidenceBands,
  FALLBACK_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds,
} from './confidenceBand';

/** Deliberately not the fallback values, so a test that passes only because
 *  the helper ignored what it was given is visible. */
const CUSTOM: ConfidenceThresholds = { high: 0.9, medium: 0.5 };

describe('confidenceBand', () => {
  it.each([
    [0.95, 'high'],
    [0.78, 'high'],
    [0.7, 'medium'],
    [0.62, 'medium'],
    [0.61, 'low'],
    [0, 'low'],
    [1, 'high'],
  ] as const)('bands %s as %s on the default cut points', (value, expected) => {
    expect(confidenceBand(value, FALLBACK_CONFIDENCE_THRESHOLDS)).toBe(expected);
  });

  it('treats the lower edge of each band as inside it', () => {
    // Matches `confidence_band` in ai_estimator/intl.py, which compares with
    // `>=`. A score sitting exactly on a published cut point is the one case
    // where a user can check the rule by hand, so getting it backwards here
    // would be the most visible possible disagreement.
    expect(confidenceBand(CUSTOM.high, CUSTOM)).toBe('high');
    expect(confidenceBand(CUSTOM.medium, CUSTOM)).toBe('medium');
  });

  it('uses the thresholds it is given, not the fallback', () => {
    // 0.8 is high by the fallback and merely medium by CUSTOM. If the helper
    // ever hardcodes its cut points again, this is the line that fails.
    expect(confidenceBand(0.8, FALLBACK_CONFIDENCE_THRESHOLDS)).toBe('high');
    expect(confidenceBand(0.8, CUSTOM)).toBe('medium');
  });

  it('falls back when the server thresholds have not arrived yet', () => {
    expect(confidenceBand(0.8)).toBe('high');
    expect(confidenceBand(0.8, null)).toBe('high');
    expect(confidenceBand(0.8, undefined)).toBe('high');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['above 1', 1.4],
    ['below 0', -0.2],
  ])('answers unknown rather than throwing for %s', (_label, value) => {
    expect(confidenceBand(value as number | null | undefined, CUSTOM)).toBe('unknown');
  });

  it('answers unknown for the offline detector, which proposes without scoring', () => {
    // Recognize (OpenCV) creates suggestions with no `confidence`. Painting
    // those as "low" would blame the tool for a number it never claimed.
    expect(confidenceBand(undefined, CUSTOM)).toBe('unknown');
  });

  it.each([
    ['inverted', { high: 0.4, medium: 0.9 }],
    ['non-finite', { high: Number.NaN, medium: 0.5 }],
    ['above 1', { high: 1.5, medium: 0.5 }],
    ['below 0', { high: 0.9, medium: -0.1 }],
  ])('ignores a %s threshold pair and uses the fallback', (_label, bad) => {
    // 0.7 is medium on the fallback. Under the inverted pair a naive
    // implementation would call it "high" (0.7 >= 0.4) while it sits below
    // that same pair's medium cut - a badge that is confidently wrong, which
    // is worse than one that is merely generic.
    expect(confidenceBand(0.7, bad as ConfidenceThresholds)).toBe('medium');
  });

  it('accepts a pair whose two cut points coincide', () => {
    // Not inverted, just a deployment that collapsed the medium band. Nothing
    // is ambiguous here, so it must be honoured rather than replaced.
    const collapsed: ConfidenceThresholds = { high: 0.7, medium: 0.7 };
    expect(confidenceBand(0.7, collapsed)).toBe('high');
    expect(confidenceBand(0.69, collapsed)).toBe('low');
  });
});

describe('countConfidenceBands', () => {
  it('counts every band, including the ones with nothing in them', () => {
    const counts = countConfidenceBands([0.95, 0.8, 0.7, 0.1, undefined], FALLBACK_CONFIDENCE_THRESHOLDS);
    expect(counts).toEqual({ high: 2, medium: 1, low: 1, unknown: 1 });
  });

  it('returns zeros for an empty queue', () => {
    // The review bar reads these directly; an absent key would render
    // "undefined low confidence".
    expect(countConfidenceBands([])).toEqual({ high: 0, medium: 0, low: 0, unknown: 0 });
  });

  it('bands the whole list against the same cut points', () => {
    const values = [0.95, 0.8, 0.55];
    expect(countConfidenceBands(values, CUSTOM)).toEqual({ high: 1, medium: 2, low: 0, unknown: 0 });
    expect(countConfidenceBands(values, FALLBACK_CONFIDENCE_THRESHOLDS)).toEqual({
      high: 2,
      medium: 0,
      low: 1,
      unknown: 0,
    });
  });
});
