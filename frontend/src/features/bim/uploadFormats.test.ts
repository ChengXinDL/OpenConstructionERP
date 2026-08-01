// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Standing guard: the BIM upload screen states one format list.
 *
 * A user reported that .dae and .3ds were "no longer visible" and read it as a
 * regression. Nothing had been removed - the badge row showed six of fifteen
 * accepted extensions behind a "+ more" span with no handler. Seven
 * hand-maintained lists lived on that screen and no two named the same set.
 *
 * These tests deliberately do NOT re-type the list. An assertion like
 * ``expect(exts).toEqual(['.rvt', ...])`` would just be list number eight: it
 * would go stale the same way, and it would pass while the screen lied. They
 * assert relationships instead - that the picker, the badge rows and the
 * routing predicate all derive from the same array.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isMeshImportFile, MESH_IMPORT_EXTENSIONS } from './meshImport/formats';
import {
  DATA_ACCEPT,
  MESH_ACCEPT,
  UPLOAD_ACCEPT,
  UPLOAD_FORMATS,
  extensionsInTier,
  formatNames,
} from './uploadFormats';

const here = dirname(fileURLToPath(import.meta.url));

describe('the accepted format list is internally consistent', () => {
  it('lists every extension exactly once', () => {
    const exts = UPLOAD_FORMATS.map((f) => f.ext);
    expect(new Set(exts).size).toBe(exts.length);
  });

  it('accepts nothing it does not also show, and shows nothing it does not accept', () => {
    // The relationship, not the contents: whatever the array holds, the
    // picker's accept string is exactly that and in that order.
    expect(UPLOAD_ACCEPT.split(',')).toEqual(UPLOAD_FORMATS.map((f) => f.ext));
  });

  it('splits cleanly into the three tiers with nothing left over', () => {
    const tiered = [
      ...extensionsInTier('bim'),
      ...extensionsInTier('handoff'),
      ...extensionsInTier('mesh'),
    ];
    expect(tiered.sort()).toEqual(UPLOAD_FORMATS.map((f) => f.ext).sort());
  });

  it('uses a leading dot and lower case throughout, which every consumer assumes', () => {
    for (const { ext } of UPLOAD_FORMATS) {
      expect(ext).toMatch(/^\.[a-z0-9]+$/);
    }
  });
});

describe('the shown list and the routing predicate cannot disagree', () => {
  /**
   * The one that matters. ``isMeshImportFile`` decides where a picked file
   * actually goes: mesh formats are parsed in-browser, everything else is
   * posted to the BIM backend. If the picker accepted a format the predicate
   * did not recognise, that file would silently fall through to the BIM upload
   * path and be sent as if it were RVT or IFC.
   */
  it('routes every format the picker accepts to the tier it is painted as', () => {
    for (const { ext, tier } of UPLOAD_FORMATS) {
      expect(isMeshImportFile(`model${ext}`), `${ext} claims tier ${tier}`).toBe(tier === 'mesh');
    }
  });

  it('leaves no mesh format out of the picker', () => {
    const shown = new Set(extensionsInTier('mesh'));
    for (const ext of MESH_IMPORT_EXTENSIONS) {
      expect(shown.has(ext), `${ext} is loadable but not offered`).toBe(true);
    }
  });

  it('keeps the geometry slot to mesh formats and the data slot to tabular ones', () => {
    expect(MESH_ACCEPT.split(',')).toEqual([...MESH_IMPORT_EXTENSIONS]);
    for (const ext of DATA_ACCEPT.split(',')) {
      expect(isMeshImportFile(`sheet${ext}`)).toBe(false);
    }
  });
});

describe('format names read correctly inside a translated sentence', () => {
  it('drops the dot and upper-cases, so a string can interpolate them', () => {
    expect(formatNames(['.rvt', '.ifc'])).toBe('RVT, IFC');
  });

  it('derives from the array, so a new format reaches every locale untouched', () => {
    expect(formatNames(extensionsInTier('bim'))).toBe('RVT, IFC');
    expect(formatNames(extensionsInTier('handoff'))).toBe('DWG, DXF');
  });
});

describe('the page does not grow an eighth list', () => {
  /**
   * The badge rows are the thing that drifted, because they were fifteen hand
   * written spans. This fails if anyone types an extension back into the JSX
   * instead of mapping over UPLOAD_FORMATS.
   */
  it('renders no hand-typed extension badge', () => {
    const src = readFileSync(join(here, 'BIMPage.tsx'), 'utf8');
    const handTyped = src.match(/>\s*\.[a-z0-9]{2,4}\s*<\/span>/g) ?? [];
    expect(handTyped).toEqual([]);
  });

  it('builds both pickers from the shared accept strings', () => {
    const src = readFileSync(join(here, 'BIMPage.tsx'), 'utf8');
    // A literal accept="..." would be a second list that the badges never see.
    expect(src).not.toMatch(/accept="\.[^"]*"/);
    expect(src).toContain('accept={UPLOAD_ACCEPT}');
  });
});
