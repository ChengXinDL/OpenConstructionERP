import { describe, expect, it } from 'vitest';

import { formatCompactCurrency } from '../money';

/**
 * A German cost report printed "203.1M EUR".
 *
 * Both halves of that are wrong for the reader it was printed for: the point
 * is a thousands separator in German, so 203.1 reads as two hundred and three
 * thousand, and M is not a magnitude letter that language uses. Four screens
 * had each grown a private compact formatter and every one of them wrote
 * `.toFixed(1)` and an English suffix, which no locale check can see because
 * the string is assembled in code rather than looked up.
 *
 * The locale is passed explicitly here rather than switched globally: what is
 * under test is the formatter, not i18next. The assertions avoid pinning the
 * exact spacing and symbol placement, which belong to the engine's CLDR data
 * and change between ICU versions - what they pin is the part that was
 * wrong, which is the separator and the magnitude word of the reader's own
 * language.
 */
describe('formatCompactCurrency', () => {
  it('gives a German reader their own separator and magnitude word', () => {
    const text = formatCompactCurrency(203_100_000, 'EUR', 'de-DE');
    expect(text).toContain('203,1');
    expect(text).toContain('Mio');
    expect(text).not.toContain('203.1');
    expect(text).not.toMatch(/\dM\b/);
  });

  it('still reads as English in English', () => {
    const text = formatCompactCurrency(203_100_000, 'EUR', 'en-US');
    expect(text).toContain('203.1M');
  });

  it('keeps the currency out when there is no usable code', () => {
    // Callers pass "" on purpose where the unit is unknown; inventing a
    // symbol there would misstate the money rather than omit it.
    const text = formatCompactCurrency(1_500_000, '', 'en-US');
    expect(text).toContain('1.5M');
    expect(text).not.toMatch(/[€$£]/);
  });

  it('does not compact what is already short', () => {
    expect(formatCompactCurrency(842, 'EUR', 'de-DE')).toContain('842');
    expect(formatCompactCurrency(842, 'EUR', 'de-DE')).not.toMatch(/K|Tsd/);
  });

  it('compacts a negative amount as one number, not as a sign and a number', () => {
    const text = formatCompactCurrency(-1_300_000, 'EUR', 'de-DE');
    expect(text).toContain('1,3');
    expect(text).toMatch(/^-|-\s?\d/u);
  });

  it('survives a wire value that arrives as a Decimal string', () => {
    expect(formatCompactCurrency('4200000.00', 'EUR', 'en-US')).toContain('4.2M');
  });

  it('never throws on a malformed locale tag', () => {
    expect(() => formatCompactCurrency(5_000_000, 'EUR', 'not a locale')).not.toThrow();
  });
});
