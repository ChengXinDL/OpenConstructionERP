// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Fraction-digit safety for the CAD-BIM BI Explorer / chart value formatter.
 *
 * `numberFormat.ts` passed *both* fraction-digit ends to `Intl` explicitly
 * (`minimumFractionDigits ?? 0`, `maximumFractionDigits ?? 2`) with no
 * try/catch. A caller overriding only the minimum therefore produced
 * `3 > 2` and an uncaught `RangeError` in a chart render path — the same
 * defect as issue #391 in `money.ts`, reached through different defaults.
 *
 * Worth stating because it is the opposite of the money case: passing both
 * ends means the engine's own ES2023 clamping never gets a chance to absorb
 * the mistake, so these throw on current V8 too, not only on older WebKit.
 *
 * The locale is mocked rather than passed, because `formatValue` reads it
 * from i18next internally and has no locale parameter. `vi.hoisted` is
 * required: `vi.mock` is hoisted above ordinary `let` declarations, so a
 * plain closure variable would be read before initialisation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en-US' }));

vi.mock('./formatters', () => ({
  getIntlLocale: () => mocks.locale,
}));

import { formatValue, formatChartValue } from './numberFormat';

beforeEach(() => {
  mocks.locale = 'en-US';
});

describe('formatValue default digit policy', () => {
  it('renders exactly what the pre-clamp defaults rendered', () => {
    // The byte-identical guard. Asserted differentially against an Intl
    // formatter built with the old hardcoded pair rather than against frozen
    // literals, because ICU output varies by environment (the sibling suite
    // in features/cad-explorer avoids exact strings for that reason).
    const reference = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    for (const value of [0, 1, 1234, 1234.5, 1234.567, -1234.5, 1234567890]) {
      expect(formatValue(value, 'number')).toBe(reference.format(value));
    }
  });

  it('keeps trailing zeros trimmed, which a point default would not', () => {
    expect(formatValue(1234, 'number')).toBe('1,234');
    expect(formatValue(1234.5, 'number')).toBe('1,234.5');
    expect(formatValue(1234.56, 'number')).toBe('1,234.56');
  });

  it('keeps the placeholder for values that are not finite', () => {
    expect(formatValue(null, 'number')).toBe('-');
    expect(formatValue(NaN, 'number')).toBe('-');
    expect(formatValue(Infinity, 'number')).toBe('-');
  });
});

describe('formatValue fraction-digit safety', () => {
  it('survives a minimum-only override above the default maximum', () => {
    // The reported shape: the minimum is raised past a maximum still sitting
    // at its own default of 2. The ceiling now rises to meet the floor, so
    // the caller's explicit request is honoured rather than discarded.
    expect(() => formatValue(1.5, 'number', { minimumFractionDigits: 3 })).not.toThrow();
    expect(formatValue(1.5, 'number', { minimumFractionDigits: 3 })).toBe('1.500');
    expect(formatValue(1.5, 'number', { minimumFractionDigits: 6 })).toBe('1.500000');
  });

  it('survives a minimum-only override on the currency and percent kinds', () => {
    // Every kind shared the same defaults, so every kind had the same hole.
    expect(() =>
      formatValue(100, 'currency', { currency: 'EUR', minimumFractionDigits: 4 }),
    ).not.toThrow();
    expect(() =>
      formatValue(0.5, 'percent', { percentAsRatio: true, minimumFractionDigits: 4 }),
    ).not.toThrow();
    expect(formatValue(0.5, 'percent', { percentAsRatio: true, minimumFractionDigits: 4 })).toBe(
      '50.0000%',
    );
  });

  it('survives negative, non-finite and over-large digit counts', () => {
    // None of these are digit counts Intl will accept. A finite but
    // out-of-range value is clamped into the accepted window; Infinity and
    // NaN are treated as "no opinion" and fall back to the default policy.
    expect(() => formatValue(1234.5, 'number', { minimumFractionDigits: -1 })).not.toThrow();
    expect(formatValue(1234.5, 'number', { minimumFractionDigits: -1 })).toBe('1,234.5');
    expect(formatValue(1234.5, 'number', { maximumFractionDigits: -1 })).toBe('1,235');
    expect(formatValue(1234.5, 'number', { maximumFractionDigits: Infinity })).toBe('1,234.5');
    expect(formatValue(1234.5, 'number', { minimumFractionDigits: NaN })).toBe('1,234.5');
    expect(formatValue(1234.5, 'number', { maximumFractionDigits: 101 })).toBe('1,234.5');
  });

  it('clamps an explicitly inverted pair down to the caller ceiling', () => {
    expect(formatValue(1234.56, 'number', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 0,
    })).toBe('1,235');
  });

  it('survives a malformed locale tag from i18next', () => {
    // getIntlLocale maps whatever i18next reports; a junk language code
    // reaches Intl as a malformed BCP-47 tag and it rejects the whole
    // construction. Falling back to the engine default locale keeps the
    // grouping a hand-rolled string would lose.
    mocks.locale = 'not a locale!!';
    expect(() => formatValue(1234.5, 'number')).not.toThrow();
    expect(formatValue(1234.5, 'number').replace(/[^0-9]/g, '')).toBe('12345');
    expect(() => formatValue(100, 'currency', { currency: 'USD' })).not.toThrow();
  });

  it('does not let one bad call poison the formatter cache for good ones', () => {
    // The cache is keyed on the resolved pair, so a clamped call and a
    // well-formed call that resolve to the same pair share an entry — which
    // is only safe if the clamping ran before the key was built.
    expect(formatValue(1234.5, 'number', { maximumFractionDigits: -1 })).toBe('1,235');
    expect(formatValue(1234.5, 'number', { maximumFractionDigits: 0 })).toBe('1,235');
    expect(formatValue(1234.5, 'number')).toBe('1,234.5');
  });
});

describe('formatChartValue', () => {
  it('echoes string labels and formats numbers safely', () => {
    expect(formatChartValue('Category A', 'number')).toBe('Category A');
    expect(formatChartValue(1234.5, 'number')).toBe('1,234.5');
    expect(() => formatChartValue(1.5, 'number', { minimumFractionDigits: 3 })).not.toThrow();
  });
});
