// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// #174 - the shared duration formatter that replaced five private copies.
//
// Two things are pinned here that the copies got wrong. First, the unit
// ladder: three of the five never climbed past their own unit, which is how
// a two-hour phone call printed as "120m" and a full-day agenda item as
// "480 min". Second, the input unit: the copies took seconds, minutes and
// milliseconds, so a shared helper with an implicit unit would have been
// wrong by 60x at four call sites without the build noticing.

import { describe, it, expect } from 'vitest';
import { formatDuration, formatElapsed } from './duration';

/** Stand-in for i18next `t`: renders the defaultValue with interpolation. */
const t = ((key: string, opts: Record<string, string | number>) => {
  void key;
  let out = String(opts.defaultValue ?? '');
  for (const [k, v] of Object.entries(opts)) {
    if (k === 'defaultValue') continue;
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  }
  return out;
}) as never;

describe('formatDuration - unit ladder', () => {
  it('stays in seconds below a minute', () => {
    expect(formatDuration(t, 45, 's')).toBe('45s');
  });

  it('climbs to minutes, hours, days and months', () => {
    expect(formatDuration(t, 90, 's')).toBe('1m');
    expect(formatDuration(t, 3600, 's')).toBe('1h');
    expect(formatDuration(t, 86_400, 's')).toBe('1d');
    expect(formatDuration(t, 60 * 86_400, 's')).toBe('2mo');
  });

  it('prints a two-hour call as 2h, which is the bug it was written for', () => {
    // The phone log's private copy returned "120m" here.
    expect(formatDuration(t, 7200, 's')).toBe('2h');
  });

  it('prints a full-day agenda item as 8h, not 480 min', () => {
    // The meetings screen's inline copy printed "480 min".
    expect(formatDuration(t, 480, 'min')).toBe('8h');
  });

  it('reads the input unit rather than assuming one', () => {
    // The same number means five different durations. A helper that guessed
    // would be wrong at four of these.
    expect(formatDuration(t, 90, 'ms')).toBe('');
    expect(formatDuration(t, 90, 's')).toBe('1m');
    expect(formatDuration(t, 90, 'min')).toBe('1h');
    expect(formatDuration(t, 90, 'h')).toBe('3d');
    expect(formatDuration(t, 90, 'd')).toBe('3mo');
  });

  it('converts milliseconds', () => {
    expect(formatDuration(t, 4500, 'ms')).toBe('4s');
    expect(formatDuration(t, 3_600_000, 'ms')).toBe('1h');
  });
});

describe('formatDuration - two-part output', () => {
  it('appends the next unit down when it carries something', () => {
    expect(formatDuration(t, 90, 's', { parts: 2 })).toBe('1m 30s');
    expect(formatDuration(t, 3700, 's', { parts: 2 })).toBe('1h 1m');
  });

  it('drops a zero remainder rather than printing "2m 0s"', () => {
    expect(formatDuration(t, 120, 's', { parts: 2 })).toBe('2m');
    expect(formatDuration(t, 7200, 's', { parts: 2 })).toBe('2h');
  });

  it('never appends a part below seconds', () => {
    expect(formatDuration(t, 45, 's', { parts: 2 })).toBe('45s');
  });
});

describe('formatDuration - absent and impossible values', () => {
  it('renders the caller\'s empty string, not "0s" or "NaNs"', () => {
    expect(formatDuration(t, null, 's', { empty: '-' })).toBe('-');
    expect(formatDuration(t, undefined, 's', { empty: '-' })).toBe('-');
    expect(formatDuration(t, 0, 's', { empty: '-' })).toBe('-');
    expect(formatDuration(t, -30, 's', { empty: '-' })).toBe('-');
    expect(formatDuration(t, Number.NaN, 's', { empty: '-' })).toBe('-');
    expect(formatDuration(t, Number.POSITIVE_INFINITY, 's', { empty: '-' })).toBe('-');
  });

  it('defaults the empty rendering to an empty string', () => {
    expect(formatDuration(t, null, 's')).toBe('');
  });
});

describe('formatElapsed', () => {
  const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('reads "just now" under a minute', () => {
    expect(formatElapsed(t, ago(5_000), { now: NOW })).toBe('just now');
    expect(formatElapsed(t, ago(59_000), { now: NOW })).toBe('just now');
  });

  it('reads "just now" for a timestamp in the future', () => {
    // A server clock running ahead is ordinary. "-2m ago" is not.
    expect(formatElapsed(t, ago(-10 * 60_000), { now: NOW })).toBe('just now');
  });

  it('climbs the same ladder as formatDuration', () => {
    expect(formatElapsed(t, ago(5 * 60_000), { now: NOW })).toBe('5m');
    expect(formatElapsed(t, ago(3 * 3_600_000), { now: NOW })).toBe('3h');
    expect(formatElapsed(t, ago(4 * 86_400_000), { now: NOW })).toBe('4d');
    expect(formatElapsed(t, ago(90 * 86_400_000), { now: NOW })).toBe('3mo');
  });

  it('does not stop at hours the way the project-intelligence copy did', () => {
    // That copy had no day or month branch, so three days read "72h ago".
    expect(formatElapsed(t, ago(3 * 86_400_000), { now: NOW, suffix: true })).toBe('3d ago');
  });

  it('adds the ago wrapper only when asked', () => {
    expect(formatElapsed(t, ago(5 * 60_000), { now: NOW })).toBe('5m');
    expect(formatElapsed(t, ago(5 * 60_000), { now: NOW, suffix: true })).toBe('5m ago');
  });

  it('accepts a Date and an epoch number, not only an ISO string', () => {
    expect(formatElapsed(t, new Date(NOW - 5 * 60_000), { now: NOW })).toBe('5m');
    expect(formatElapsed(t, NOW - 5 * 60_000, { now: NOW })).toBe('5m');
  });

  it('renders the empty string for a missing or unparseable timestamp', () => {
    expect(formatElapsed(t, null, { now: NOW, empty: '-' })).toBe('-');
    expect(formatElapsed(t, 'not a date', { now: NOW, empty: '-' })).toBe('-');
  });
});
