// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko
//
// #149 - /data-explorer was named several different ways. Three names were on
// the page itself (breadcrumb, header heading, empty-state hero) and more were
// on other pages linking to it, so a user could read "Data Explorer" in the BIM
// explainer, click it, and land on a page headed "CAD-BIM BI Explorer".
//
// WHY THIS FILE CHANGED SHAPE. The first version of this guard listed the keys
// that were known to hold a second name and asserted nothing read them. That
// denylist is why the first census of this defect came back short: a call site
// that mints a NEW key holding the OLD English text is invisible to a list of
// keys, and four such sites (ai.open_explorer, ai.open_data_explorer,
// files.module.data_explorer, howto.data-explorer.title) were missed on the
// first pass and found only when the search moved from keys to destinations.
//
// So the load-bearing assertion is now RETIRED_NAMES, not RETIRED_NAME_KEYS: no
// source file may contain a whole string literal equal to a name this page used
// to go by, whatever key it hangs on. That catches the shapes the label/navigate
// regex structurally cannot see - `route: (_p, f) => withParam('/data-explorer')`
// beside a `label:`, a `['/data-explorer', '...']` tuple, `<P title="...">` on a
// <Route>, and a titleDefault in a help catalogue entry.
//
// WHAT THIS GUARD DELIBERATELY DOES NOT ASSERT. Prose that mentions the page
// inside a sentence ("...jump out to the Data Explorer or the map...") is the
// same defect in kind but is not a whole string literal, and for the ones that
// matter the rendered English lives in en.ts, which this agent does not own.
// Asserting on substrings would make this guard wider than the artifact and
// permanently red on text nobody here can fix. Those are handed to the locale
// owner instead; see the report. A guard that cannot be satisfied gets weakened,
// and a weakened guard is worse than a narrow one.
//
// Run: npx vitest run src/features/cad-explorer/__tests__/oneNamePerPage.test.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const HERE = resolve(__dirname, '..');
const SRC = resolve(HERE, '..', '..');
const PAGE = resolve(HERE, 'CadDataExplorerPage.tsx');
const APP = resolve(SRC, 'app', 'App.tsx');
const HEADER = resolve(SRC, 'app', 'layout', 'Header.tsx');

const SOURCE = readFileSync(PAGE, 'utf-8');

/** The key the Sidebar entry for /data-explorer uses (Sidebar.tsx:343). */
const NAV_KEY = 'nav.cad_bim_explorer';

/** en.ts's value for NAV_KEY. Every defaultValue in the tree must match it. */
const ENGLISH = 'CAD-BIM BI Explorer';

/**
 * Names this page used to go by. A whole string literal equal to any of these
 * is a second name for /data-explorer regardless of which key carries it.
 */
const RETIRED_NAMES = ['Data Explorer', 'CAD/BIM Data Explorer', 'CAD-BIM Explorer'];

/**
 * Keys that held a second name for this page. They may still exist in the
 * locale files - dropping keys is the locale owner's job - but nothing under
 * the scanned roots may read them.
 */
const RETIRED_NAME_KEYS = [
  'explorer.title',
  'explorer.hero_title',
  'nav.data_explorer',
  'bim.intro_link_explorer',
  'cad_takeoff.intro_link_explorer',
  'ai.open_explorer',
  'ai.open_data_explorer',
  'files.module.data_explorer',
  'howto.data-explorer.title',
];

/**
 * Roots to scan. `app/locales` is excluded by name: those files legitimately
 * hold "Data Explorer" as the translated value of keys this guard does not
 * own, and including them would make the guard permanently unsatisfiable.
 */
const ROOTS = ['app', 'features', 'shared'];

/** Every .ts/.tsx under the roots, excluding tests and locale bundles. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules' && entry !== 'locales') {
        sourceFiles(full, out);
      }
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/');

/**
 * Blank out commentary, preserving line numbers so offenders still report a
 * usable location.
 *
 * Both halves were forced by a wrong answer. The first red run of this guard
 * reported CadDataExplorerPage.tsx:3919, which is the third line of a
 * multi-line `{/* #149: ... *\/}` comment quoting the retired name to explain
 * this very fix. A line-prefix test cannot see that: continuation lines of a
 * JSX block comment start with ordinary prose, not with `//` or `*`. So block
 * comments are matched across lines and replaced with their own newlines.
 *
 * Line comments are handled by prefix rather than by stripping `//` anywhere,
 * because a URL inside a string literal contains `//` and a blind strip would
 * silently truncate the line and hide whatever followed it.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

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
    expect(new Set(fallbacks)).toEqual(new Set([ENGLISH]));
  });
});

describe('no other surface mints a second name for it (#149)', () => {
  const FILES = ROOTS.flatMap((r) => sourceFiles(resolve(SRC, r)));

  it('scans a real set of files across app, features and shared', () => {
    // Guards the walker itself. An empty or tiny list would make every
    // assertion below vacuously true, which is the failure mode of a
    // filesystem scan - it reports clean when it searched nothing.
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES).toContain(PAGE);
    expect(FILES).toContain(APP);
    expect(FILES).toContain(HEADER);
  });

  it.each(RETIRED_NAMES)('no file holds %o as a whole string literal', (name) => {
    // The load-bearing one. Whole-literal, so prose that merely mentions the
    // page in a sentence is out of scope by construction - see the header.
    const pattern = new RegExp(`(['"\`])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);
    const offenders: string[] = [];
    for (const file of FILES) {
      stripComments(readFileSync(file, 'utf-8'))
        .split('\n')
        .forEach((line, i) => {
          if (pattern.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
        });
    }

    expect(offenders).toEqual([]);
  });

  it.each(RETIRED_NAME_KEYS)('no scanned file reads %s', (key) => {
    const offenders = FILES.filter((f) => readFileSync(f, 'utf-8').includes(`'${key}'`)).map(rel);

    expect(offenders).toEqual([]);
  });

  it('spells the English fallback the same way everywhere it links there', () => {
    // A defaultValue that drifts here is invisible until a locale is missing
    // the key, and then one page says something the others do not.
    const wrong: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(
        new RegExp(`t\\('${NAV_KEY}',\\s*\\{\\s*defaultValue:\\s*'([^']*)'`, 'g'),
      )) {
        if (m[1] !== ENGLISH) wrong.push(`${rel(file)}: ${m[1]}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('every link to /data-explorer that carries a label uses the one key', () => {
    // The shape that produced the defect: `{ label: t(<some key>), onClick:
    // () => navigate('/data-explorer') }` in an explainer's related-modules
    // row. Four pages wrote it, three of them with a key of their own.
    //
    // Two constraints, both learned from a wrong answer rather than guessed.
    //
    // `(?!label:)` - these links come in lists, and a pattern that may cross
    // a newline otherwise runs from one entry's `label:` into the NEXT
    // entry's navigate(), reporting the neighbour's key. A red run blamed
    // `bim.intro_link_boq` for the line below it.
    //
    // `{0,200}` - without a span limit the match reached from a label on
    // QuickEstimatePage:3038 to a bare `navigate('/data-explorer')` on 3487,
    // 449 lines away and not a link label at all. The shape being matched is
    // a compact object literal; the real call sites all fit in about 80
    // characters, and SnapshotsPage needs the newline only because it puts
    // label and onClick on separate lines.
    const minted: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(
        /label:\s*t\('([^']+)'((?!label:)[\s\S]){0,200}?navigate\('\/data-explorer'\)/g,
      )) {
        if (m[1] !== NAV_KEY) minted.push(`${rel(file)}: ${m[1]}`);
      }
    }

    expect(minted).toEqual([]);
  });
});

describe('the route title and the title map move together (#149)', () => {
  // The coupling that has no build error and no other test. App.tsx passes a
  // bare English string as the <P title>, and Header's TITLE_I18N_MAP turns
  // that string into an i18n key. Header.tsx:195 falls back to
  // `t(title, { defaultValue: title })` when the lookup misses, which renders
  // the English literal in all 28 non-English locales and throws nothing. So
  // renaming the route title without renaming the map key is a silent
  // regression from "translated" to "English everywhere".
  const appSource = readFileSync(APP, 'utf-8');
  const headerSource = readFileSync(HEADER, 'utf-8');

  const routeTitle = appSource.match(
    /<Route path="\/data-explorer"[^>]*?<P title="([^"]+)"/,
  )?.[1];

  const mapBlock = headerSource.slice(
    headerSource.indexOf('const TITLE_I18N_MAP'),
    headerSource.indexOf('export function resolvePageTitleKey'),
  );
  const titleMap = new Map(
    [...mapBlock.matchAll(/^\s*'([^']+)':\s*'([^']+)',/gm)].map((m) => [m[1], m[2]]),
  );

  it('finds the route title and a populated map', () => {
    // Both parsers are regexes over someone else's file. If either silently
    // stops matching, the assertions below pass on undefined and this guard
    // becomes decoration.
    expect(routeTitle).toBeDefined();
    expect(titleMap.size).toBeGreaterThan(50);
  });

  it('the /data-explorer route title resolves through the map to the nav key', () => {
    expect(titleMap.get(routeTitle as string)).toBe(NAV_KEY);
  });

  it('the route title is the current English name, not a retired one', () => {
    // Without this the pair above is satisfied by moving both to any string,
    // including back to "Data Explorer".
    expect(routeTitle).toBe(ENGLISH);
  });
});
