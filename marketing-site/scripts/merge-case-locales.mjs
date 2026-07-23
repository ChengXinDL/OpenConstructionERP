#!/usr/bin/env node
/* ================================================================
 * merge-case-locales.mjs
 *
 * Merges per-language case translations (produced from
 * scratchpad/cases_gap_source.json by the fan-out translators) into the
 * app locale files at frontend/src/app/locales/<code>.ts.
 *
 * Input: scratchpad/cases_gap_<code>.json, a FLAT map of
 *   { "cases.<slug_underscored>.<path>": "translated text", ... }
 * matching the key paths in cases_gap_source.json.
 *
 * For each language it injects every pair as a new
 *   "keyPath": "value",
 * entry into that locale's flat translation object, immediately after
 * the last existing cases.* key (keeping the case strings grouped and
 * the file's quote / indent / newline style intact).
 *
 * Correctness:
 *   - Idempotent: a key that already exists is SKIPPED, never
 *     overwritten or duplicated. Re-running is a no-op.
 *   - TS-safe escaping: backslash, double quote, newline, CR and tab in
 *     the translated value are escaped so the file stays valid
 *     TypeScript.
 *   - Preserves the file's existing newline (CRLF vs LF) and the indent
 *     of the surrounding keys.
 *   - Touches nothing but the inserted lines.
 *
 * Language codes (URL code -> locale file): same name, except
 *   es-mx -> es-MX.ts.
 *
 * Usage:
 *   node merge-case-locales.mjs                 # every cases_gap_<code>.json found
 *   node merge-case-locales.mjs de zh           # only these languages
 *   node merge-case-locales.mjs --dry-run       # report, write nothing
 *   node merge-case-locales.mjs --scratch <dir> --locales-dir <dir>
 * ================================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MARKETING_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(MARKETING_ROOT, '..');

// URL/directory codes -> locale .ts basename.
const CODES = [
  'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'ru', 'bg', 'tr', 'sv', 'no',
  'fi', 'da', 'ar', 'zh', 'ja', 'ko', 'hi', 'hr', 'id', 'mn', 'ro', 'th', 'vi',
  'es-mx',
];
const localeFileFor = (code) => (code === 'es-mx' ? 'es-MX.ts' : `${code}.ts`);

// ---- args ------------------------------------------------------

function parseArgs(argv) {
  const out = {
    dryRun: false,
    langs: [],
    scratch: join(REPO_ROOT, 'scratchpad'),
    localesDir: join(REPO_ROOT, 'frontend/src/app/locales'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--scratch') out.scratch = resolve(argv[++i]);
    else if (a === '--locales-dir') out.localesDir = resolve(argv[++i]);
    else if (!a.startsWith('--')) out.langs.push(a);
  }
  return out;
}

// ---- helpers ---------------------------------------------------

// Escape a translated string for a double-quoted TypeScript literal.
function escapeTs(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\t/g, '\\t');
}

// Keys already declared in the file (flat "key": ... lines). Keys are
// dotted identifiers with no embedded quotes, so a simple scan is exact.
function existingKeys(text) {
  const keys = new Set();
  const re = /^\s*"([^"\\]+)"\s*:/gm;
  let m;
  while ((m = re.exec(text)) !== null) keys.add(m[1]);
  return keys;
}

function countCaseKeys(text) {
  const m = text.match(/^\s*"cases\.[^"\\]+"\s*:/gm);
  return m ? m.length : 0;
}

// ---- merge one language ---------------------------------------

function mergeLang(code, args) {
  const gapPath = join(args.scratch, `cases_gap_${code}.json`);
  const localePath = join(args.localesDir, localeFileFor(code));
  const result = { code, present: false, added: 0, skipped: 0, caseKeysAfter: 0, notes: [] };

  if (!existsSync(gapPath)) {
    result.notes.push(`no ${`cases_gap_${code}.json`}`);
    return result;
  }
  if (!existsSync(localePath)) {
    result.notes.push(`locale file missing: ${localeFileFor(code)}`);
    return result;
  }
  result.present = true;

  let pairs;
  try {
    pairs = JSON.parse(readFileSync(gapPath, 'utf8'));
  } catch (e) {
    result.notes.push(`invalid JSON: ${e.message}`);
    return result;
  }
  // The gap file may be flat (keyPath -> value) or nested by slug
  // ({ slug: { keyPath: value } }); flatten either into one key map.
  const flat = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (v && typeof v === 'object') {
      for (const [kk, vv] of Object.entries(v)) flat[kk] = vv;
    } else {
      flat[k] = v;
    }
  }

  const text = readFileSync(localePath, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const have = existingKeys(text);

  // Anchor: after the last existing cases.* key line.
  let anchor = -1;
  let indent = '    ';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)"cases\.[^"\\]+"\s*:/);
    if (m) {
      anchor = i;
      indent = m[1];
    }
  }
  if (anchor === -1) {
    // No cases.* key at all: fall back to just before the translation
    // object's closing brace (the "  }" that precedes "} as {").
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\} as \b/.test(lines[i]) || /^\} as \{/.test(lines[i])) {
        // the line above is the translation-object close brace
        anchor = i - 2 >= 0 ? i - 2 : i - 1;
        break;
      }
    }
    if (anchor === -1) {
      result.notes.push('could not find an insertion anchor');
      return result;
    }
  }

  const newLines = [];
  for (const [key, val] of Object.entries(flat)) {
    if (have.has(key)) {
      result.skipped++;
      continue;
    }
    newLines.push(`${indent}"${key}": "${escapeTs(val)}",`);
    have.add(key); // guard against duplicate keys within the same input
    result.added++;
  }

  if (result.added > 0 && !args.dryRun) {
    lines.splice(anchor + 1, 0, ...newLines);
    writeFileSync(localePath, lines.join(eol));
  }

  const afterText = args.dryRun
    ? text + eol + newLines.join(eol)
    : readFileSync(localePath, 'utf8');
  result.caseKeysAfter = countCaseKeys(afterText);
  return result;
}

// ---- main ------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  let codes = args.langs.length ? args.langs : null;
  if (!codes) {
    // Auto-discover cases_gap_<code>.json for known codes only (so the
    // English cases_gap_source.json is never treated as a language).
    const found = [];
    let entries = [];
    try {
      entries = readdirSync(args.scratch);
    } catch {
      entries = [];
    }
    for (const f of entries) {
      const m = f.match(/^cases_gap_(.+)\.json$/);
      if (m && CODES.includes(m[1])) found.push(m[1]);
    }
    codes = CODES.filter((c) => found.includes(c));
  }

  const unknown = codes.filter((c) => !CODES.includes(c));
  if (unknown.length) {
    console.error(`merge-case-locales: unknown language code(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  console.log(`${args.dryRun ? '[dry-run] ' : ''}merge-case-locales`);
  console.log(`  scratch: ${args.scratch}`);
  console.log(`  locales: ${args.localesDir}`);
  if (!codes.length) {
    console.log('  no cases_gap_<code>.json files found - nothing to merge.');
    return;
  }

  let totalAdded = 0;
  let totalSkipped = 0;
  for (const code of codes) {
    const r = mergeLang(code, args);
    if (!r.present) {
      console.log(`  ${code}: skipped (${r.notes.join('; ')})`);
      continue;
    }
    totalAdded += r.added;
    totalSkipped += r.skipped;
    const note = r.notes.length ? ` [${r.notes.join('; ')}]` : '';
    console.log(
      `  ${code} -> ${localeFileFor(code)}: added ${r.added}, skipped-existing ${r.skipped}, cases.* keys now ${r.caseKeysAfter}${note}`,
    );
  }
  console.log(`  TOTAL: added ${totalAdded}, skipped-existing ${totalSkipped}`);
}

main();
