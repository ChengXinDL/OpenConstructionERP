// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The text display preference and its localStorage round-trip.
 *
 * The reload case is the point of the file: a viewer setting that resets on
 * every page load is one the user re-does on every drawing, which is the same
 * as not having it. ``loadTextDisplay`` reading back what ``saveTextDisplay``
 * wrote, out of the same storage, is exactly what a reload does - the module
 * holds no state of its own between the two calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_TEXT_DISPLAY,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  TEXT_DISPLAY_KEY,
  clampTextScale,
  loadTextDisplay,
  saveTextDisplay,
  stepTextScale,
} from '../text-display-store';

describe('clampTextScale', () => {
  it('keeps a value inside the range untouched', () => {
    expect(clampTextScale(1)).toBe(1);
    expect(clampTextScale(1.75)).toBe(1.75);
  });

  it('pulls values outside the range back to the ends', () => {
    expect(clampTextScale(0.01)).toBe(MIN_TEXT_SCALE);
    expect(clampTextScale(400)).toBe(MAX_TEXT_SCALE);
    expect(clampTextScale(-3)).toBe(MIN_TEXT_SCALE);
  });

  it('turns anything that is not a finite number into the drawing’s own size', () => {
    // NaN paints nothing at all while the control still reads as on, which is
    // worse than ignoring the stored value. Infinity is corruption too, not a
    // request for the largest supported size, so it gets the same treatment
    // rather than being clamped to the top of the range.
    expect(clampTextScale(NaN)).toBe(1);
    expect(clampTextScale(Infinity)).toBe(1);
    expect(clampTextScale('big' as unknown as number)).toBe(1);
  });
});

describe('stepTextScale', () => {
  it('steps up and down by a quarter', () => {
    expect(stepTextScale(1, 1)).toBeCloseTo(1.25);
    expect(stepTextScale(1, -1)).toBeCloseTo(0.75);
  });

  it('stops at the ends instead of running past them', () => {
    expect(stepTextScale(MAX_TEXT_SCALE, 1)).toBe(MAX_TEXT_SCALE);
    expect(stepTextScale(MIN_TEXT_SCALE, -1)).toBe(MIN_TEXT_SCALE);
  });

  it('lands on round percentages after repeated steps', () => {
    // Read back as "125%", not "124.99999999999999%".
    let s = MIN_TEXT_SCALE;
    for (let i = 0; i < 8; i++) s = stepTextScale(s, 1);
    expect(s).toBe(MAX_TEXT_SCALE);
    expect(Math.round(stepTextScale(stepTextScale(1, 1), 1) * 100)).toBe(150);
  });
});

describe('text-display-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts at the drawing’s own text, shown', () => {
    expect(loadTextDisplay()).toEqual(DEFAULT_TEXT_DISPLAY);
  });

  it('survives a reload', () => {
    // Save, then load again with nothing carried over in memory - the same
    // sequence a page reload runs.
    saveTextDisplay({ visible: false, scale: 1.5 });
    expect(loadTextDisplay()).toEqual({ visible: false, scale: 1.5 });

    saveTextDisplay({ visible: true, scale: 0.75 });
    expect(loadTextDisplay()).toEqual({ visible: true, scale: 0.75 });
  });

  it('writes one constant key, not one per drawing', () => {
    // How big a user wants to read is about the user, so the key carries no
    // drawing id and switching drawings cannot lose the setting.
    saveTextDisplay({ visible: false, scale: 2 });
    expect(localStorage.getItem(TEXT_DISPLAY_KEY)).toBe('{"visible":false,"scale":2}');
  });

  it('falls back to the default for a malformed entry', () => {
    localStorage.setItem(TEXT_DISPLAY_KEY, '{not json');
    expect(loadTextDisplay()).toEqual(DEFAULT_TEXT_DISPLAY);
    localStorage.setItem(TEXT_DISPLAY_KEY, '"a string"');
    expect(loadTextDisplay()).toEqual(DEFAULT_TEXT_DISPLAY);
  });

  it('repairs a half-written entry field by field', () => {
    // A downgrade-era or hand-edited entry keeps whatever it got right.
    localStorage.setItem(TEXT_DISPLAY_KEY, JSON.stringify({ visible: false }));
    expect(loadTextDisplay()).toEqual({ visible: false, scale: 1 });
    localStorage.setItem(TEXT_DISPLAY_KEY, JSON.stringify({ scale: 2 }));
    expect(loadTextDisplay()).toEqual({ visible: true, scale: 2 });
  });

  it('clamps a stored multiplier on the way in and on the way out', () => {
    saveTextDisplay({ visible: true, scale: 99 });
    expect(loadTextDisplay().scale).toBe(MAX_TEXT_SCALE);
    localStorage.setItem(TEXT_DISPLAY_KEY, JSON.stringify({ visible: true, scale: 0 }));
    expect(loadTextDisplay().scale).toBe(MIN_TEXT_SCALE);
  });
});
