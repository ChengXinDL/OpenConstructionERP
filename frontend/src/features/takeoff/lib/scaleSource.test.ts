// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The client states a scale source only when it knows one.
 *
 * These tests are mostly about the cases where the honest answer is "we do not
 * know". A provenance field that guesses is worse than one that admits a gap,
 * because a re-scale uses it to decide which rows to recompute, and a laundered
 * guess would quietly exclude the rows that needed recomputing most.
 */

import { describe, expect, it } from 'vitest';

import { defaultScaleConfig } from '../../../modules/pdf-takeoff/data/page-scales';
import {
  FACTORY_DEFAULT_PIXELS_PER_UNIT,
  attributeScaleSource,
  inferredCalibrationPages,
} from './scaleSource';

describe('attributeScaleSource', () => {
  it('credits a stated per-page calibration to the person who made it', () => {
    expect(
      attributeScaleSource({
        pixelsPerUnit: 144,
        pageHasOwnCalibration: true,
        calibrationIsInferred: false,
      }),
    ).toBe('manual_calibration');
  });

  it('refuses to credit a calibration it only inferred', () => {
    // This is the whole point of the module. The restore heuristic is good
    // enough to bring a usable ratio back; it is not good enough to record as
    // a human act, and NULL says exactly that.
    expect(
      attributeScaleSource({
        pixelsPerUnit: 144,
        pageHasOwnCalibration: true,
        calibrationIsInferred: true,
      }),
    ).toBeNull();
  });

  it('records a page riding the document default as a preset', () => {
    expect(
      attributeScaleSource({
        pixelsPerUnit: 100,
        pageHasOwnCalibration: false,
        calibrationIsInferred: false,
      }),
    ).toBe('preset');
  });

  it('ignores the inferred flag when the page has no calibration of its own', () => {
    // The flag describes a per-page calibration. With none, it says nothing,
    // and letting it leak through would turn every default page into a NULL.
    expect(
      attributeScaleSource({
        pixelsPerUnit: 100,
        pageHasOwnCalibration: false,
        calibrationIsInferred: true,
      }),
    ).toBe('preset');
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -25],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('names no source when the ratio is %s', (_label, ppu) => {
    expect(
      attributeScaleSource({
        pixelsPerUnit: ppu,
        pageHasOwnCalibration: true,
        calibrationIsInferred: false,
      }),
    ).toBeNull();
  });
});

describe('inferredCalibrationPages', () => {
  const row = (
    page: number,
    ppu: number | null,
    flag?: boolean,
  ): { page: number; scale_pixels_per_unit: number | null; metadata: Record<string, unknown> } => ({
    page,
    scale_pixels_per_unit: ppu,
    metadata: flag === undefined ? {} : { scale_calibrated: flag },
  });

  it('flags a legacy row that the restore heuristic will treat as calibrated', () => {
    expect([...inferredCalibrationPages([row(3, 144)])]).toEqual([3]);
  });

  it('does not flag a page whose calibration was stated outright', () => {
    expect(inferredCalibrationPages([row(3, 144, true)]).size).toBe(0);
  });

  it('does not flag a page the restore will leave uncalibrated', () => {
    // An explicit false means the page was never calibrated, so the restore
    // skips it entirely and there is nothing to be uncertain about.
    expect(inferredCalibrationPages([row(3, 144, false)]).size).toBe(0);
  });

  it('does not flag a legacy row still sitting on the factory ratio', () => {
    expect(
      inferredCalibrationPages([row(3, FACTORY_DEFAULT_PIXELS_PER_UNIT)]).size,
    ).toBe(0);
  });

  it('lets one stated row settle a page that also has legacy rows', () => {
    // Mixed rows are the normal case for a document edited across the upgrade.
    // One row stating the fact settles it; treating the page as uncertain
    // because an older sibling lacks the flag would throw away real knowledge.
    expect(
      inferredCalibrationPages([row(3, 144), row(3, 144, true), row(3, 144)]).size,
    ).toBe(0);
  });

  it('settles a page regardless of which row states the flag first', () => {
    expect(inferredCalibrationPages([row(3, 144, true), row(3, 144)]).size).toBe(0);
  });

  it('keeps pages independent of one another', () => {
    expect([
      ...inferredCalibrationPages([row(1, 144, true), row(2, 25), row(3, 100)]),
    ]).toEqual([2]);
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -5],
  ])('skips a row whose ratio is %s', (_label, ppu) => {
    // The restore skips these too, so they can neither calibrate a page nor
    // make one uncertain.
    expect(inferredCalibrationPages([row(4, ppu)]).size).toBe(0);
  });

  it('tolerates a row with no metadata at all', () => {
    expect([
      ...inferredCalibrationPages([{ page: 7, scale_pixels_per_unit: 144 }]),
    ]).toEqual([7]);
  });

  it('returns an empty set for no rows', () => {
    expect(inferredCalibrationPages([]).size).toBe(0);
  });
});

describe('the factory ratio', () => {
  it('matches the viewer page-scale model', () => {
    // This module keeps its own copy to stay free of a cross-layer import.
    // Pin them together so a change to the model cannot silently turn every
    // uncalibrated legacy page into an inferred one.
    expect(FACTORY_DEFAULT_PIXELS_PER_UNIT).toBe(
      defaultScaleConfig().pixelsPerUnit,
    );
  });
});
