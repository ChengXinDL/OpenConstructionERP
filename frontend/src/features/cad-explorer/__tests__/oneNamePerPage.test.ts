// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// #149 - /data-explorer carried six English labels across four surfaces, and
// three of them were on the page itself: the breadcrumb, the header heading
// and the empty-state hero. A user arriving from the sidebar watched the name
// change under them.
//
// This is a source-level guard, and the distinction from a behavioural test
// matters. CadDataExplorerPage is ~4000 lines behind a router, several stores
// and a dozen queries; the three labels sit in three different render
// branches (the hero only exists with no session loaded, the header heading
// only when `describe` is absent), so a DOM test would need three separate
// mounted scenarios to see all three. What is actually worth pinning is
// narrower and stable: the page must not name itself from any key other than
// the one the Sidebar entry uses, and no hardcoded literal may stand in for
// that name.
//
// The full six-surface convergence is a founder decision (translations are
// frozen until the wording settles). This guard holds under either outcome:
// whichever name is chosen, it lives in one key.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '..', 'CadDataExplorerPage.tsx'),
  'utf-8',
);

/** The key the Sidebar entry for /data-explorer uses (Sidebar.tsx:343). */
const NAV_KEY = 'nav.cad_bim_explorer';

/**
 * Keys that used to hold a second English copy of this page's name. They may
 * still exist in the locale files - dropping keys is the locale owner's job -
 * but the page must not read them.
 */
const RETIRED_NAME_KEYS = ['explorer.title', 'explorer.hero_title'];

describe('/data-explorer names itself once (#149)', () => {
  it('reads its name from the key the sidebar entry uses', () => {
    expect(SOURCE).toContain(`t('${NAV_KEY}'`);
  });

  it('names the page in three places - breadcrumb, heading, hero', () => {
    // Three render branches, one key. If a fourth surface is added it should
    // join them rather than mint a name, and this count is what says so.
    const uses = SOURCE.match(new RegExp(`t\\('${NAV_KEY}'`, 'g')) ?? [];
    expect(uses).toHaveLength(3);
  });

  it('no longer reads a second key holding the same name', () => {
    for (const key of RETIRED_NAME_KEYS) {
      expect(SOURCE).not.toContain(`t('${key}'`);
    }
  });

  it('agrees with the sidebar on the English fallback', () => {
    // A defaultValue that differs from the locale value is a name that
    // appears only when the key is missing. This page carried
    // "CAD-BIM Explorer" that way, against en.ts's "CAD-BIM BI Explorer".
    const fallbacks = [
      ...SOURCE.matchAll(
        new RegExp(`t\\('${NAV_KEY}',\\s*\\{\\s*defaultValue:\\s*'([^']*)'`, 'g'),
      ),
    ].map((m) => m[1]);

    expect(fallbacks).toHaveLength(3);
    expect(new Set(fallbacks)).toEqual(new Set(['CAD-BIM BI Explorer']));
  });
});
