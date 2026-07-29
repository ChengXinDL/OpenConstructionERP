// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';
import {
  PLAUSIBLE_MAX_M,
  PLAUSIBLE_MIN_M,
  isImplausibleBuildingSize,
  isMeshImportFile,
  meshFormatFromName,
  suggestUnitForExtent,
} from './formats';

/**
 * The unit table the dialog passes in. Duplicated here on purpose: importing
 * it from ``loaders.ts`` would drag three.js and nine addon loaders into a
 * test of pure arithmetic, and these five factors are definitional.
 */
const UNIT_CODES = ['mm', 'cm', 'm', 'in', 'ft'] as const;
type UnitCode = (typeof UNIT_CODES)[number];
const UNIT_TO_METERS: Record<UnitCode, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

const suggest = (extent: number, current: UnitCode): UnitCode | null =>
  suggestUnitForExtent(extent, current, UNIT_CODES, UNIT_TO_METERS);

describe('mesh format classification', () => {
  it('recognises the importable extensions and rejects authored CAD', () => {
    expect(meshFormatFromName('tower.DAE')).toBe('dae');
    expect(meshFormatFromName('scan.glb')).toBe('glb');
    expect(isMeshImportFile('bracket.3ds')).toBe(true);
    // These go to the server-side converter, not the in-browser importer.
    expect(isMeshImportFile('model.ifc')).toBe(false);
    expect(isMeshImportFile('plan.dwg')).toBe(false);
    expect(isMeshImportFile('notes')).toBe(false);
  });
});

describe('source-unit plausibility', () => {
  it('accepts sizes a building actually has', () => {
    expect(isImplausibleBuildingSize(12.4)).toBe(false); // a house
    expect(isImplausibleBuildingSize(180)).toBe(false); // a tower
    expect(isImplausibleBuildingSize(PLAUSIBLE_MIN_M)).toBe(false); // inclusive
    expect(isImplausibleBuildingSize(PLAUSIBLE_MAX_M)).toBe(false); // inclusive
  });

  it('flags a model that is a thousand times too small or too large', () => {
    expect(isImplausibleBuildingSize(0.0124)).toBe(true); // metres read as mm
    expect(isImplausibleBuildingSize(12_400)).toBe(true); // mm read as metres
  });

  it('stays quiet on a degenerate or not-yet-measured model', () => {
    // An empty parse reports 0; that is "nothing to say", not "wrong unit".
    expect(isImplausibleBuildingSize(0)).toBe(false);
    expect(isImplausibleBuildingSize(-5)).toBe(false);
    expect(isImplausibleBuildingSize(Number.NaN)).toBe(false);
  });
});

describe('unit suggestion', () => {
  it('recovers a metre file opened as millimetres', () => {
    // The file says 12.4; at mm that renders as 0.0124 m, which is absurd.
    expect(isImplausibleBuildingSize(12.4 * UNIT_TO_METERS.mm)).toBe(true);
    expect(suggest(12.4, 'mm')).toBe('m');
  });

  it('recovers a millimetre file opened as metres', () => {
    expect(isImplausibleBuildingSize(12_400 * UNIT_TO_METERS.m)).toBe(true);
    expect(suggest(12_400, 'm')).toBe('mm');
  });

  it('searches the whole ladder, not just its metric head', () => {
    // Contrived on purpose. With metres already selected and skipped, an
    // extent of 5 is too small under mm, cm and inches alike, so feet is the
    // only candidate left - which proves the tail of the list is reached.
    expect(suggest(5, 'm')).toBe('ft');
  });

  it('never suggests the unit already selected', () => {
    for (const unit of UNIT_CODES) {
      expect(suggest(12_400, unit)).not.toBe(unit);
    }
  });

  it('returns null when no unit rescues the model', () => {
    // A billion source units is not a building under any of the five.
    expect(suggest(1e9, 'm')).toBeNull();
    expect(suggest(0, 'm')).toBeNull();
    expect(suggest(Number.NaN, 'm')).toBeNull();
  });

  it('only ever proposes a unit that lands inside the band', () => {
    // Property check: whatever comes back must actually fix the problem.
    for (const extent of [0.004, 4, 4_000, 4e6, 1e-6, 7.5, 913]) {
      for (const current of UNIT_CODES) {
        const proposed = suggest(extent, current);
        if (proposed === null) continue;
        const metres = extent * UNIT_TO_METERS[proposed];
        expect(isImplausibleBuildingSize(metres)).toBe(false);
      }
    }
  });
});
