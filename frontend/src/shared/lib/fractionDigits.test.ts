// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Unit tests for the shared fraction-digit clamp.
 *
 * These assert the contract directly, without going through `Intl`, because
 * the invariant the two callers depend on is `minimum <= maximum` with both
 * ends inside the accepted window — and that is what silently regresses when
 * somebody "simplifies" the resolution rule later.
 *
 * The two callers pass different defaults on purpose. `money.ts` passes a
 * point (a currency's own minor units: two-decimal money shows both decimals
 * or it does not look like money). `numberFormat.ts` passes the range [0, 2]
 * (chart axes mix counts, areas and amounts in one column and trim trailing
 * zeros). Both shapes are pinned here so neither can be changed by accident
 * while trying to fix the other.
 */
import { describe, it, expect } from 'vitest';
import { resolveFractionDigits, sanitizeFractionDigits } from './fractionDigits';

const MONEY = { minimum: 2, maximum: 2 };
const ZERO_DECIMAL = { minimum: 0, maximum: 0 };
const CHART = { minimum: 0, maximum: 2 };

describe('sanitizeFractionDigits', () => {
  it('passes through counts already inside the accepted window', () => {
    expect(sanitizeFractionDigits(0)).toBe(0);
    expect(sanitizeFractionDigits(2)).toBe(2);
    expect(sanitizeFractionDigits(20)).toBe(20);
  });

  it('reports "no opinion" for undefined and non-finite counts', () => {
    // Infinity and NaN are not digit counts. Reading them as 0 would be a
    // worse answer than deferring to the caller's own default.
    expect(sanitizeFractionDigits(undefined)).toBeUndefined();
    expect(sanitizeFractionDigits(Infinity)).toBeUndefined();
    expect(sanitizeFractionDigits(-Infinity)).toBeUndefined();
    expect(sanitizeFractionDigits(NaN)).toBeUndefined();
  });

  it('clamps finite counts outside the window Intl accepts', () => {
    expect(sanitizeFractionDigits(-1)).toBe(0);
    expect(sanitizeFractionDigits(-100)).toBe(0);
    expect(sanitizeFractionDigits(21)).toBe(20);
    expect(sanitizeFractionDigits(101)).toBe(20);
  });

  it('truncates a fractional count the way Intl would', () => {
    expect(sanitizeFractionDigits(2.7)).toBe(2);
    expect(sanitizeFractionDigits(-0.5)).toBe(0);
  });
});

describe('resolveFractionDigits', () => {
  it('returns the caller defaults untouched when no override is given', () => {
    // The byte-identical guard for both call sites: this is the pair that
    // every existing chart axis and money cell is rendering today.
    expect(resolveFractionDigits(undefined, CHART)).toEqual({
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    expect(resolveFractionDigits({}, MONEY)).toEqual({
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(resolveFractionDigits({}, ZERO_DECIMAL)).toEqual({
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  });

  it('raises the ceiling to meet a floor-only override', () => {
    // The caller stated a floor and nothing else, so the floor is honoured
    // and the ceiling gives way. Discarding the explicit request would be
    // the wrong repair.
    expect(resolveFractionDigits({ minimumFractionDigits: 3 }, CHART)).toEqual({
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
    expect(resolveFractionDigits({ minimumFractionDigits: 2 }, ZERO_DECIMAL)).toEqual({
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it('leaves a floor-only override below the default ceiling alone', () => {
    expect(resolveFractionDigits({ minimumFractionDigits: 1 }, CHART)).toEqual({
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
  });

  it('lowers the floor to meet a ceiling-only override', () => {
    // The ceiling is the caller's hard constraint: a summary card that asked
    // for whole numbers is sized for whole numbers.
    expect(resolveFractionDigits({ maximumFractionDigits: 0 }, MONEY)).toEqual({
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    expect(resolveFractionDigits({ maximumFractionDigits: 4 }, CHART)).toEqual({
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  });

  it('lowers the floor when both ends are given inverted', () => {
    expect(
      resolveFractionDigits({ minimumFractionDigits: 4, maximumFractionDigits: 1 }, CHART),
    ).toEqual({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  });

  it('never yields an inverted or out-of-range pair, for any input', () => {
    // Exhaustive sweep over the nonsense a caller can produce, against every
    // default shape in use. The invariant is what the callers rely on to
    // drop their try/catch, so it is asserted rather than argued.
    const counts = [undefined, NaN, Infinity, -Infinity, -100, -1, 0, 1, 2, 3, 20, 21, 101, 2.7];
    for (const defaults of [MONEY, ZERO_DECIMAL, CHART, { minimum: 3, maximum: 3 }]) {
      for (const min of counts) {
        for (const max of counts) {
          const out = resolveFractionDigits(
            { minimumFractionDigits: min, maximumFractionDigits: max },
            defaults,
          );
          expect(out.minimumFractionDigits).toBeLessThanOrEqual(out.maximumFractionDigits);
          expect(out.minimumFractionDigits).toBeGreaterThanOrEqual(0);
          expect(out.maximumFractionDigits).toBeLessThanOrEqual(20);
          expect(Number.isInteger(out.minimumFractionDigits)).toBe(true);
          expect(Number.isInteger(out.maximumFractionDigits)).toBe(true);
          // The pair is the real contract: Intl must accept it.
          expect(() => new Intl.NumberFormat('en-US', out)).not.toThrow();
        }
      }
    }
  });
});
