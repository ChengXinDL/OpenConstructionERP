// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Tests for the Gantt time header generator.
 *
 * The header cells carry a width that the top-row renderer used to ignore, which
 * is how two month labels ended up painted over each other. These pin the shape
 * the renderer depends on: cells tile the timeline without overlapping, and a
 * cell can be far narrower than the label it carries.
 */
import { describe, it, expect } from 'vitest';
import { generateTimeHeaders, COLUMN_WIDTH, type ViewMode } from './ganttUtils';

const LOCALE = 'en-US';

describe('generateTimeHeaders', () => {
  it('tiles the top row without gaps or overlaps', () => {
    // Overlap here would be a generator bug. It is not the bug this file was
    // written for, but it is the assumption the clip fix rests on: each label
    // may own its own cell and nothing else.
    const modes: ViewMode[] = ['day', 'week', 'month', 'quarter', 'year'];
    for (const mode of modes) {
      const { topRow } = generateTimeHeaders(
        new Date(2026, 0, 25),
        new Date(2026, 5, 30),
        mode,
        LOCALE,
      );
      expect(topRow.length, `${mode} produced no top row`).toBeGreaterThan(0);
      for (let i = 1; i < topRow.length; i++) {
        const prev = topRow[i - 1]!;
        expect(topRow[i]!.x, `${mode} cell ${i} does not start where ${i - 1} ends`).toBeCloseTo(
          prev.x + prev.width,
          5,
        );
      }
    }
  });

  it('gives a mid-month start a leading cell far narrower than a whole month', () => {
    // The reported case: the range opens on 25 January, so January owns seven
    // days of timeline while still being labelled "January 2026".
    const { topRow } = generateTimeHeaders(
      new Date(2026, 0, 25),
      new Date(2026, 2, 31),
      'week',
      LOCALE,
    );

    const [leading, second] = topRow;
    expect(leading).toBeDefined();
    expect(second).toBeDefined();

    // Assert the relationship, not a pixel count: the numbers move the moment
    // COLUMN_WIDTH.week is retuned, the relationship does not.
    expect(leading!.width).toBeLessThan(second!.width / 3);
    expect(leading!.width).toBeLessThan(COLUMN_WIDTH.week * 1.5);
  });

  it('labels a partial month exactly as fully as a whole one', () => {
    // This is the precondition the renderer ignored. The generator does clamp
    // the width to the visible part of the month, and deliberately does not
    // shorten the label to match, so width and label length are unrelated.
    const { topRow } = generateTimeHeaders(
      new Date(2026, 0, 25),
      new Date(2026, 2, 31),
      'week',
      LOCALE,
    );

    const partial = topRow[0]!;
    const whole = topRow[1]!;
    expect(partial.label).toBe('January 2026');
    expect(whole.label).toBe('February 2026');
    // Roughly a seventh of the room for a label of the same order of length.
    expect(partial.label.length).toBeGreaterThan(whole.label.length - 3);
  });

  it('leaves a whole month room for its own label at week zoom', () => {
    // The other half of the report: full months are fine, so the fix must not
    // start trimming labels that were never in trouble. At 10px semibold a
    // "February 2026" is roughly 85px and February gets four weeks of width.
    const { topRow } = generateTimeHeaders(
      new Date(2026, 1, 1),
      new Date(2026, 4, 31),
      'week',
      LOCALE,
    );
    for (const cell of topRow.slice(0, -1)) {
      expect(cell.width, `${cell.label} is too narrow to hold its own label`).toBeGreaterThan(100);
    }
  });

  it('does not reproduce the collision at day zoom', () => {
    // Same seven-day January, six times the pixels per day. This is why the
    // report named week zoom specifically, and it is worth pinning so a later
    // change to COLUMN_WIDTH.day does not quietly create a second instance.
    const { topRow } = generateTimeHeaders(
      new Date(2026, 0, 25),
      new Date(2026, 2, 31),
      'day',
      LOCALE,
    );
    expect(topRow[0]!.width).toBeGreaterThan(100);
  });
});
