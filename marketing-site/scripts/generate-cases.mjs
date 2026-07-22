#!/usr/bin/env node
/* ================================================================
 * generate-cases.mjs
 *
 * Multilingual static-page generator for the OpenConstructionERP
 * marketing "Cases" (construction playbooks). It publishes one SEO
 * landing page per case per supported language, so every playbook is
 * indexable in every language the platform already speaks.
 *
 * Where the content comes from:
 *   - Playbook STRUCTURE + English text: the app's own case data at
 *     frontend/src/features/cases/data/*.playbook.ts (bundled on the
 *     fly with esbuild, which is how the app reads them too). Category
 *     and company-type labels come from categories.ts / companyTypes.ts.
 *   - TRANSLATIONS: the app locale files frontend/src/app/locales/*.ts.
 *     Each carries ~2500 flat "cases.<slug>.<field>" keys plus the
 *     nav.* module names and cases.cat.* / cases.company.* labels. A
 *     missing key falls back to the inline English default.
 *   - The exact page TEMPLATE (markup, CSS, bespoke per-case SVG scenes,
 *     icons, colours): the committed English pages in marketing-site/
 *     cases/<slug>.html. The English page is the ground truth; a
 *     localized page is the same bytes with the translatable text runs
 *     swapped and the SEO head cluster injected. This guarantees the
 *     scenes and layout never drift between languages.
 *
 * URL scheme (matches the /xx/ convention Caddy already serves via
 * try_files {path} {path}.html):
 *   - English : /cases/<slug>            file cases/<slug>.html
 *   - Other   : /<lang>/cases/<slug>     file <lang>/cases/<slug>.html
 *
 * Per-page SEO, added to every language (English included):
 *   - <html lang> (and dir="rtl" for Arabic)
 *   - translated <title>, meta description, og:title / og:description
 *   - canonical for that language
 *   - a full reciprocal hreflang alternate cluster
 *     (x-default = English + every language)
 *   - og:locale, og:url
 *   - JSON-LD HowTo structured data (name/description + one HowToStep
 *     per step) for rich results
 * The injected head block sits between <!--oce:cases-seo--> markers so a
 * re-run replaces it in place: the generator is deterministic and
 * idempotent.
 *
 * Header: the template's own header is replaced on every page with a clone
 * of the homepage top navigation (see cases-nav.css + buildHeader), with
 * its labels and link targets baked per language - no runtime i18n. The
 * theme toggle and mobile burger get a small inline script; all header
 * assets carry markers so re-runs strip and re-inject them cleanly.
 *
 * Usage:
 *   node generate-cases.mjs                 # write all languages
 *   node generate-cases.mjs --dry-run       # report, write nothing
 *   node generate-cases.mjs --lang de       # one language (English head
 *                                           #   injection always runs)
 *   node generate-cases.mjs --base https://example.com
 * ================================================================ */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { CHROME, NAV_PILL } from './cases-chrome.mjs';
import { buildSwitcher, detailHref, SWITCHER_JS, SWITCH_LANGS } from './cases-switcher.mjs';
import { PLATFORM_MODULE_TOTAL, moduleSlug } from './cases-constants.mjs';

// Languages that have a localized gallery index (/<lang>/cases). The module
// filter links point there when available, and fall back to /cases otherwise.
const LOCALIZED_GALLERY = new Set(SWITCH_LANGS.map((l) => l.code).filter((c) => c !== 'en'));

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MARKETING_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(MARKETING_ROOT, '..');

const DEFAULT_BASE = 'https://openconstructionerp.com';

// The homepage top-navigation CSS, lifted verbatim (+ a sticky adaptation and
// a dark-theme token block) so every case page renders the same header. See
// cases-nav.css for the two deliberate differences from the landing page.
const NAV_CSS = readFileSync(join(SCRIPT_DIR, 'cases-nav.css'), 'utf8');

// ---- module honeycomb (shared with the gallery) ----------------
// Each detail page renders its own case's modules as solid hexes ringed by
// ghost hexes for the platform's other modules. The visual rules are the
// @hive-core block of cases-hive.css (the exact component the gallery uses);
// here we bake static positions + the case's module list per page.
const HIVE_CSS_FULL = readFileSync(join(SCRIPT_DIR, 'cases-hive.css'), 'utf8');
const HIVE_CORE_CSS = (() => {
  const m = HIVE_CSS_FULL.match(/\/\*\s*@hive-core:start[\s\S]*?@hive-core:end[\s\S]*?\*\//);
  if (!m) throw new Error('cases-hive.css: @hive-core block not found');
  return m[0];
})();

// Detail-page layout: the "How it works" steps and the modules honeycomb sit
// side by side (steps left, a slim vertical module panel right). The hexes are
// stacked into a tall, narrow 2-wide column. On narrow screens the panel drops
// below the steps. Label text is tuned to always sit inside the hexagon.
const CASE_HIVE_CSS = `
/* Smaller hero illustration so it no longer dominates the top of the page. */
.dhero .scene{ width: 100%; max-width: 400px; margin-left: auto; }
/* Steps + modules panel, side by side. */
.case-body{
  display: grid;
  grid-template-columns: minmax(0, 1fr) 236px;
  gap: 42px;
  align-items: start;
}
.case-body > .steps{ margin: 0; min-width: 0; }
/* The module honeycomb as a slim, sticky vertical panel beside the steps. */
.case-hive{
  position: sticky;
  top: 84px;
  margin: 0;
  padding: 18px 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  border: 1px solid var(--line-1);
  border-radius: 16px;
  background: color-mix(in oklab, var(--band-accent, var(--accent)) 4%, transparent);
}
.case-hive .ch-eyebrow{
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: .62rem;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--ink-3);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.case-hive .ch-eyebrow::before{
  content: "";
  width: 18px;
  height: 2px;
  background: var(--band-accent, var(--accent));
  display: inline-block;
}
.case-hive .ch-title{
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-weight: 680;
  font-size: 1rem;
  letter-spacing: -.02em;
  line-height: 1.2;
  color: var(--ink-0);
  margin: 8px 0 0;
  max-width: 16ch;
  text-wrap: balance;
}
.case-hive-stage{ position: relative; margin: 16px auto 2px; }
/* Keep the hex label inside the hexagon: the polygon narrows toward its
   left/right points, so keep text in the central band with generous side
   padding, a small font, graceful wrapping and a clamp - never clipping
   across the angled border. */
.case-hive .hc-face{ padding: 13% 20%; }
.case-hive .hc-face .hc-ico{ width: 20px; height: 20px; font-size: 13px; margin-bottom: 1px; }
.case-hive .hc-face .hc-title{
  font-size: 10.5px;
  line-height: 1.08;
  max-width: 100%;
  -webkit-line-clamp: 3;
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: auto;
}
.case-hive .ch-note{
  margin: 12px 0 2px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: .62rem;
  letter-spacing: .04em;
  color: var(--ink-3);
}
.case-hive .ch-note b{ color: var(--ink-1); font-weight: 700; }
@media (max-width: 900px){
  /* Panel drops below the steps and centres. */
  .case-body{ grid-template-columns: 1fr; gap: 26px; }
  .case-hive{ position: static; width: 100%; max-width: 300px; margin: 0 auto; }
  .dhero .scene{ max-width: 420px; margin: 0 auto; }
}
`;

const CASE_HIVE_CSS_BLOCK =
  `<!--oce:case-hive-css--><style id="oce-case-hive-css">\n${HIVE_CORE_CSS}\n${CASE_HIVE_CSS}\n</style><!--/oce:case-hive-css-->`;

// Per-case module lists + the global module vocabulary (the ghost pool),
// the same source the gallery reads, so a case shows identical modules on
// both surfaces. Module names stay English on every language.
const MODULES_RAW = JSON.parse(readFileSync(join(SCRIPT_DIR, 'case-modules.json'), 'utf8'));

const HIVE_CANON = {
  'take-off': 'Takeoff', 'takeoff': 'Takeoff', 'daily diary': 'Daily Diary',
  'rfi': 'RFIs', 'rfis': 'RFIs', 'bim viewer': 'BIM Viewer',
  'advanced schedule': 'Advanced Schedule', 'advanced scheduling': 'Advanced Schedule',
  'schedule advanced': 'Advanced Schedule', 'non-conformance': 'Non-conformances',
  'non-conformances': 'Non-conformances', 'project files': 'Project Files',
};
const hiveCanon = (label) => HIVE_CANON[String(label).trim().toLowerCase()] || String(label).trim();
function normModules(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const c = hiveCanon(raw);
    const k = c.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}
const HIVE_ALL = (() => {
  const seen = new Set();
  const all = [];
  for (const slug of Object.keys(MODULES_RAW)) {
    for (const m of normModules(MODULES_RAW[slug])) {
      const k = m.toLowerCase();
      if (!seen.has(k)) { seen.add(k); all.push(m); }
    }
  }
  return all;
})();

const HIVE_ICONS = {
  'boq': '☰', 'cost explorer': '€', 'costs': '€', 'finance': '€', 'payroll': '€', 'value': '◇',
  'assemblies': '❏', 'labour rates': '€', 'resources': '▦', 'resource summary': '▦', 'production norms': '∑',
  'validation': '✓', 'quality': '✓', 'quality management': '✓', 'qms': '✓', 'inspections': '☑', 'forms': '▤',
  'reports': '▤', 'report': '▤', 'portal': '◧', 'contracts': '§', 'reconciliation': '⇄', 'procurement': '⛟',
  'tendering': '⎙', 'bid management': '⚖', 'subcontractors': '⛏', 'allowances': '◇', 'preliminaries': '▦',
  'schedule': '◷', 'advanced schedule': '◷', 'progress': '◔', 'portfolio': '▦', 'capacity planning': '▤',
  'bim': '◈', '3d model': '◈', 'bim viewer': '◈', 'federations': '⬡', 'clash detection': '✷', 'coordination': '⬡',
  'model issues': '❈', 'model review': '◈', 'carbon': '♻', 'point cloud': '⁙', 'takeoff': '✶', 'documents': '▦',
  'files': '▦', 'project files': '▤', 'correspondence': '✉', 'rfis': '?', 'rfi': '?', 'markups': '✎', 'compare': '⇆',
  'safety': '⛑', 'ncr': '⚠', 'non-conformances': '⚠', 'punch list': '☑', 'close-out': '⚑', 'handover': '⚑',
  'assets': '⚙', 'service': '⚙', 'field time': '⏱', 'daily diary': '✎', 'site diary': '✎', 'projects': '◫',
  'risk register': '⚠', 'meetings': '☷', 'tasks': '☑', 'crm': '☎', 'contacts': '☎', 'change orders': '⇄',
  'change intelligence': '✷', 'equipment': '⚙', 'catalog': '▦',
};
function hiveIcon(name) {
  const k = String(name).toLowerCase().trim();
  if (HIVE_ICONS[k]) return HIVE_ICONS[k];
  for (const key of Object.keys(HIVE_ICONS)) { if (k.indexOf(key) >= 0) return HIVE_ICONS[key]; }
  const m = String(name).replace(/[^A-Za-z0-9]/g, '');
  return m ? m.charAt(0).toUpperCase() : '◆';
}
// Flat-top hex spiral of axial coords: centre first, then rings out.
function hiveSpiral(radius) {
  const out = [{ q: 0, r: 0 }];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (let k = 1; k <= radius; k++) {
    let q = dirs[4][0] * k, r = dirs[4][1] * k;
    for (let s = 0; s < 6; s++) {
      for (let step = 0; step < k; step++) { out.push({ q, r }); q += dirs[s][0]; r += dirs[s][1]; }
    }
  }
  return out;
}

// A slim 2-wide vertical honeycomb, read top to bottom, for the tall side
// panel on the detail pages. The case's own modules fill the top rows, the
// ghost hexes trail below.
function hiveColumn(count) {
  const out = [];
  let r = 0;
  while (out.length < count) {
    out.push({ q: 0, r });
    if (out.length < count) out.push({ q: 1, r });
    r += 1;
  }
  return out;
}

// Build the static honeycomb band for one case. Solid hexes are the case's
// own modules; ghosts are one to two rings of the platform's other modules.
// Positions are baked so the band needs no runtime JS. Labels come from the
// module vocabulary (English); heading text is passed in (localized).
function buildCaseHive({ mods, color, eyebrow, title, noteTpl, filterBase }) {
  const n = mods.length;
  if (!n) return '';
  const own = new Set(mods.map((m) => m.toLowerCase()));
  const ghosts = HIVE_ALL.filter((m) => !own.has(m.toLowerCase()));
  const ghostCount = Math.min(ghosts.length, Math.max(3, 8 - n));
  const used = hiveColumn(n + ghostCount);
  const w = 92, h = w * 0.866, col = w * 0.75;
  const pos = used.map((c) => ({ x: c.q * col, y: h * (c.r + c.q / 2) }));
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + w;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + h;
  const cw = Math.round(maxX - minX), chh = Math.round(maxY - minY);
  const r2 = (v) => Math.round(v * 100) / 100;
  let hex = '';
  used.forEach((c, i) => {
    const x = Math.round(pos[i].x - minX), y = Math.round(pos[i].y - minY);
    if (i < n) {
      const name = mods[i];
      const href = `${filterBase || '/cases'}/?module=${moduleSlug(name)}`;
      const label = `See all cases using ${name}`;
      hex += `<a class="hc-cell" href="${href}" aria-label="${escText(label)}" title="${escText(label)}" ` +
        `style="left:${x}px;top:${y}px;--tint:${color};animation-delay:${r2(i * 0.04)}s">` +
        `<span class="hc-face"><span class="hc-ico" aria-hidden="true">${hiveIcon(name)}</span>` +
        `<span class="hc-title">${escText(name)}</span></span></a>`;
    } else {
      const name = ghosts[i - n];
      hex += `<span class="hc-ghost" style="left:${x}px;top:${y}px;--tint:${color};animation-delay:${r2(0.1 + (i - n) * 0.018)}s">` +
        `<span class="hc-gface"><span class="hc-gico" aria-hidden="true">${hiveIcon(name)}</span></span></span>`;
    }
  });
  const note = escText(noteTpl)
    .replace('{n}', `<b>${n}</b>`)
    .replace('{total}', `<b>${PLATFORM_MODULE_TOTAL}</b>`);
  const stageStyle = `width:${cw}px;height:${chh}px;--hc-w:${w}px;--hc-h:${Math.round(h)}px`;
  return `<!--oce:case-hive--><section class="case-hive" style="--band-accent:${color}" aria-label="Modules this playbook uses">` +
    `<span class="ch-eyebrow">${escText(eyebrow)}</span>` +
    `<h2 class="ch-title">${escText(title)}</h2>` +
    `<div class="case-hive-stage" style="${stageStyle}">${hex}</div>` +
    `<p class="ch-note">${note}</p>` +
    `</section><!--/oce:case-hive-->`;
}

// Languages with a localized home snapshot (/<lang>/) AND a localized
// uberization whitepaper (/uberization-of-construction/<lang>). For every
// other language the header points its logo / section links / whitepaper
// link at the English home and English whitepaper instead.
const HOME_LANGS = new Set([
  'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'ru', 'bg', 'tr', 'sv', 'no',
  'fi', 'da', 'ar', 'zh', 'ja', 'ko',
]);

// ---- languages -------------------------------------------------
// One row per fully translated app locale. `code` is the URL directory
// and the default hreflang; `ts` is the locale file basename; `og` is
// the Open Graph locale. English is implicit (the /cases root) and is
// always part of the hreflang cluster as en + x-default.
const LANGS = [
  { code: 'de', ts: 'de', og: 'de_DE' },
  { code: 'fr', ts: 'fr', og: 'fr_FR' },
  { code: 'es', ts: 'es', og: 'es_ES' },
  { code: 'it', ts: 'it', og: 'it_IT' },
  { code: 'pt', ts: 'pt', og: 'pt_PT' },
  { code: 'nl', ts: 'nl', og: 'nl_NL' },
  { code: 'pl', ts: 'pl', og: 'pl_PL' },
  { code: 'cs', ts: 'cs', og: 'cs_CZ' },
  { code: 'ru', ts: 'ru', og: 'ru_RU' },
  { code: 'bg', ts: 'bg', og: 'bg_BG' },
  { code: 'tr', ts: 'tr', og: 'tr_TR' },
  { code: 'sv', ts: 'sv', og: 'sv_SE' },
  { code: 'no', ts: 'no', og: 'nb_NO' },
  { code: 'fi', ts: 'fi', og: 'fi_FI' },
  { code: 'da', ts: 'da', og: 'da_DK' },
  { code: 'ar', ts: 'ar', og: 'ar_AE', rtl: true },
  { code: 'zh', ts: 'zh', og: 'zh_CN' },
  { code: 'ja', ts: 'ja', og: 'ja_JP' },
  { code: 'ko', ts: 'ko', og: 'ko_KR' },
  { code: 'hi', ts: 'hi', og: 'hi_IN' },
  { code: 'hr', ts: 'hr', og: 'hr_HR' },
  { code: 'id', ts: 'id', og: 'id_ID' },
  { code: 'mn', ts: 'mn', og: 'mn_MN' },
  { code: 'ro', ts: 'ro', og: 'ro_RO' },
  { code: 'th', ts: 'th', og: 'th_TH' },
  { code: 'vi', ts: 'vi', og: 'vi_VN' },
  { code: 'es-mx', ts: 'es-MX', og: 'es_MX', hreflang: 'es-MX' },
];

const hreflangOf = (l) => l.hreflang || l.code;

// ---- args ------------------------------------------------------

function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, dryRun: false, lang: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--lang') out.lang = argv[++i];
  }
  out.base = out.base.replace(/\/+$/, '');
  return out;
}

// ---- escaping / truncation ------------------------------------

// Text escaping identical to React's renderToStaticMarkup, so the
// English default strings match what is in the committed pages
// byte-for-byte (& < > " ' -> entities, apostrophe as &#x27;).
function escText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Hard character slice with an ellipsis, mirroring the template's own
// truncation (meta descriptions ~155 chars, related-card blurbs ~92).
function truncate(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+$/, '') + '…';
}
const truncMeta = (s) => truncate(s, 155);
const truncCard = (s) => truncate(s, 92);

// ---- esbuild-backed loaders -----------------------------------

const require = createRequire(join(REPO_ROOT, 'frontend', 'package.json'));
const esbuild = require('esbuild');

let TMP;
function tmpFile(name) {
  if (!TMP) {
    TMP = join(tmpdir(), `oce-cases-${process.pid}`);
    mkdirSync(TMP, { recursive: true });
  }
  return join(TMP, name);
}

async function bundleImport(entrySource, resolveDir, outName) {
  const outfile = tmpFile(outName);
  await esbuild.build({
    stdin: { contents: entrySource, resolveDir, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

async function loadData() {
  const dataDir = join(REPO_ROOT, 'frontend/src/features/cases/data');
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.playbook.ts')).sort();
  const imports = files
    .map((f, i) => `import pb_${i} from ${JSON.stringify(join(dataDir, f))};`)
    .join('\n');
  const arr = files.map((_, i) => `pb_${i}`).join(',');
  const catsPath = join(REPO_ROOT, 'frontend/src/features/cases/categories.ts');
  const compPath = join(REPO_ROOT, 'frontend/src/features/cases/companyTypes.ts');
  const entry = `${imports}
import { CATEGORY_META, CATEGORY_ACCENT, NEUTRAL_ACCENT } from ${JSON.stringify(catsPath)};
import { COMPANY_TYPE_META } from ${JSON.stringify(compPath)};
export const playbooks = [${arr}];
export const categories = CATEGORY_META.map((c) => ({ id: c.id, labelKey: c.labelKey, labelDefault: c.labelDefault, accent: CATEGORY_ACCENT[c.id] || NEUTRAL_ACCENT }));
export const companies = COMPANY_TYPE_META.map((c) => ({ id: c.id, labelKey: c.labelKey, labelDefault: c.labelDefault }));
`;
  const mod = await bundleImport(entry, dataDir, 'data.mjs');
  return { playbooks: mod.playbooks, categories: mod.categories, companies: mod.companies };
}

async function loadLocales() {
  const localesDir = join(REPO_ROOT, 'frontend/src/app/locales');
  const rows = LANGS.map((l, i) => `import loc_${i} from ${JSON.stringify(join(localesDir, l.ts + '.ts'))};`);
  const map = LANGS.map((l, i) => `${JSON.stringify(l.code)}: loc_${i}.translation`).join(',');
  const entry = `${rows.join('\n')}
export const locales = { ${map} };
`;
  const mod = await bundleImport(entry, localesDir, 'locales.mjs');
  return mod.locales;
}

// ---- SEO head block -------------------------------------------

function altCluster(base, slug) {
  const alts = [
    { hreflang: 'x-default', href: `${base}/cases/${slug}` },
    { hreflang: 'en', href: `${base}/cases/${slug}` },
  ];
  for (const l of LANGS) alts.push({ hreflang: hreflangOf(l), href: `${base}/${l.code}/cases/${slug}` });
  return alts;
}

function jsonLd(base, slug, langCode, T, pb) {
  const title = T(pb.titleKey, pb.titleDefault);
  const desc = T(pb.descKey, pb.descDefault);
  const canonical =
    langCode === 'en' ? `${base}/cases/${slug}` : `${base}/${langCode}/cases/${slug}`;
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description: desc,
    inLanguage: langCode,
    totalTime: `PT${pb.estMinutes}M`,
    url: canonical,
    step: pb.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: T(s.titleKey, s.titleDefault),
      text: T(s.whatKey, s.whatDefault),
    })),
  };
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function seoBlock(base, slug, lang, T, pb) {
  const canonical =
    lang.code === 'en' ? `${base}/cases/${slug}` : `${base}/${lang.code}/cases/${slug}`;
  const out = ['<!--oce:cases-seo-->'];
  out.push(`<meta property="og:locale" content="${lang.og}"/>`);
  out.push(`<meta property="og:url" content="${canonical}"/>`);
  for (const a of altCluster(base, slug)) {
    out.push(`<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`);
  }
  out.push(
    `<script type="application/ld+json">${jsonLd(base, slug, hreflangOf(lang), T, pb)}</script>`,
  );
  out.push('<!--/oce:cases-seo-->');
  return out.join('');
}

// ---- header (homepage nav clone) ------------------------------

// Per-language link targets for the header. The logo and the in-page section
// links resolve to the localized home when one exists, else the English home;
// Cases / Docs / News / Demo / Download are shared paths; the whitepaper link
// picks the localized whitepaper when one exists.
function headerLinks(code) {
  const home = HOME_LANGS.has(code) ? `/${code}/` : '/';
  const uber = HOME_LANGS.has(code)
    ? `/uberization-of-construction/${code}`
    : '/uberization-of-construction/';
  return {
    home,
    tour: `${home}#tour`,
    compare: `${home}#compare`,
    pricing: `${home}#pricing`,
    cases: '/cases',
    docs: '/docs',
    news: '/news',
    uber,
    demo: '/demo',
    download: '/download',
    github: 'https://github.com/datadrivenconstruction/openconstructionerp',
  };
}

// A verbatim clone of the homepage header, fully baked for one language:
// labels come from the chrome table + nav.* locale keys, links from
// headerLinks(). The brand and the GitHub pill keep their names in every
// language. The whole thing is wrapped in a <header> so a re-run re-matches
// and replaces it in place (idempotent). Language-agnostic runtime (theme
// toggle + burger) is injected separately by injectNavAssets().
function buildHeader(lang, T, ch, slug) {
  const code = lang.code;
  const isEn = code === 'en';
  const pill = NAV_PILL[code] || {};
  // URL-based language switcher: each item navigates to this same case in
  // the chosen language (/<lang>/cases/<slug>, English at /cases/<slug>).
  const langSwitch = '<!--oce:lang-switch-->' + buildSwitcher(code, detailHref(slug)) + '<!--/oce:lang-switch-->';
  const L = {
    tour: escText(ch ? ch.navTour : 'Tour'),
    compare: escText(ch ? ch.navCompare : 'Compare'),
    cases: escText(isEn ? 'Cases' : T('nav.cases', 'Cases')),
    pricing: escText(ch ? ch.navPricing : 'Pricing'),
    docs: escText(isEn ? 'Docs' : T('nav.docs', 'Docs')),
    news: escText(ch ? ch.navNews : 'News'),
    uber: escText(ch ? ch.navUberization : 'Uberization'),
    demo: escText(pill.demo || 'Demo'),
    download: escText(pill.download || 'Download'),
  };
  const H = headerLinks(code);
  const arrow =
    '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  return `<header class="oce-hd"><nav class="nav" id="nav" aria-label="Primary">
    <div class="nav-inner">
      <div class="nav-left">
        <a class="brand" href="${H.home}">
          <span class="brand-name">
            <span class="brand-seg brand-seg-1">Open</span><span class="brand-seg brand-seg-2">Construction</span><span class="brand-seg brand-seg-3">ERP</span>
          </span>
        </a>

        <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
          </svg>
        </button>
      </div>

      <div class="nav-links nav-links-slot">
        <a href="${H.tour}">${L.tour}</a>
        <a href="${H.compare}">${L.compare}</a>
        <a href="${H.cases}">${L.cases}</a>
        <a href="${H.pricing}">${L.pricing}</a>
        <a href="${H.docs}">${L.docs}</a>
        <a href="${H.news}">${L.news}</a>
        <a class="nav-wp" href="${H.uber}" style="display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;opacity:.8"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 13h6M9 17h4"/></svg>${L.uber}</a>
      </div>

      <div class="nav-right">
        <a class="demo-pill" href="${H.demo}" aria-label="Try the live demo">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <span>${L.demo}</span>
        </a>

        <a class="github-pill" href="${H.github}" target="_blank" rel="noopener" aria-label="Star us on GitHub">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 0.5C5.65 0.5 0.5 5.65 0.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.05 0 0 .97-.31 3.18 1.18A11 11 0 0 1 12 6.8a11 11 0 0 1 2.9.39c2.2-1.5 3.17-1.18 3.17-1.18.63 1.58.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.15v3.19c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>
          <span>GitHub</span>
        </a>

        <a class="install-pill" href="${H.download}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>${L.download}</span>
        </a>

        ${langSwitch}

        <button type="button" class="nav-burger" id="nav-burger" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobile-menu">
          <svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="17" x2="20" y2="17"/>
          </svg>
          <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="6" y1="18" x2="18" y2="6"/>
          </svg>
        </button>
      </div>
    </div>
  </nav>
  <div class="mobile-menu" id="mobile-menu" role="dialog" aria-label="Mobile navigation" aria-modal="true">
    <a href="${H.demo}"><span>${L.demo}</span>${arrow}</a>
    <a href="${H.tour}"><span>${L.tour}</span>${arrow}</a>
    <a href="${H.compare}"><span>${L.compare}</span>${arrow}</a>
    <a href="${H.cases}"><span>${L.cases}</span>${arrow}</a>
    <a href="${H.pricing}"><span>${L.pricing}</span>${arrow}</a>
    <a href="${H.docs}"><span>${L.docs}</span>${arrow}</a>
    <a href="${H.news}"><span>${L.news}</span>${arrow}</a>
    <a href="${H.uber}"><span>${L.uber}</span>${arrow}</a>
    <div class="cta-row">
      <a class="btn btn-primary" href="${H.download}"><span>${L.download}</span></a>
    </div>
  </div>
  </header>`;
}

// One-time page assets the cloned header needs: its CSS, a tiny sync theme
// initializer in <head> (applies the stored oce-theme before first paint so
// there is no flash), and the theme-toggle + burger interaction script before
// </body>. All three carry stable markers so a re-run strips and re-injects
// them cleanly.
const NAV_CSS_BLOCK = `<style id="oce-cases-nav-css">\n${NAV_CSS}\n</style>`;
const NAV_THEME_INIT = `<!--oce:nav-theme-init--><script>(function(){try{var t=localStorage.getItem('oce-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();</script><!--/oce:nav-theme-init-->`;
const NAV_JS = `<!--oce:nav-js--><script>(function(){var root=document.documentElement,body=document.body;var tt=document.getElementById('theme-toggle');if(tt)tt.addEventListener('click',function(){var d=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=d;try{localStorage.setItem('oce-theme',d);}catch(e){}});var burger=document.getElementById('nav-burger'),menu=document.getElementById('mobile-menu');function setOpen(o){body.classList.toggle('nav-open',o);if(burger)burger.setAttribute('aria-expanded',o?'true':'false');body.style.overflow=o?'hidden':'';}if(burger)burger.addEventListener('click',function(){setOpen(!body.classList.contains('nav-open'));});if(menu)menu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setOpen(false);});});document.addEventListener('keydown',function(e){if(e.key==='Escape')setOpen(false);});})();</script><!--/oce:nav-js-->`;
const SWITCHER_JS_BLOCK = `<!--oce:lang-switch-js--><script>${SWITCHER_JS}</script><!--/oce:lang-switch-js-->`;

function injectNavAssets(html) {
  html = html.replace('</head>', `${NAV_CSS_BLOCK}${NAV_THEME_INIT}</head>`);
  // Strip a prior switcher script, then inject it with the nav wiring so the
  // language menu opens/closes. Idempotent via its sentinel markers.
  html = html.replace(/<!--oce:lang-switch-js-->[\s\S]*?<!--\/oce:lang-switch-js-->/, '');
  html = html.replace('</body>', `${NAV_JS}${SWITCHER_JS_BLOCK}</body>`);
  return html;
}

// ---- page builder ---------------------------------------------

function buildPage({ rawEnglish, pb, lang, base, locales, catById, compById, stats }) {
  const isEn = lang.code === 'en';
  const map = isEn ? null : locales[lang.code];
  let missing = 0;
  const T = (key, def) => {
    if (isEn) return def;
    const v = map ? map[key] : undefined;
    if (v == null || v === '') {
      missing++;
      return def;
    }
    return v;
  };

  // Always start from a clean template (strip any previously injected blocks:
  // the SEO head cluster and the header's CSS / theme-init / interaction JS).
  // The header itself is replaced in place below, so it needs no strip here.
  let html = rawEnglish
    .replace(/<!--oce:cases-seo-->[\s\S]*?<!--\/oce:cases-seo-->/, '')
    .replace(/<style id="oce-cases-nav-css">[\s\S]*?<\/style>/, '')
    .replace(/<!--oce:nav-theme-init-->[\s\S]*?<!--\/oce:nav-theme-init-->/, '')
    .replace(/<!--oce:nav-js-->[\s\S]*?<!--\/oce:nav-js-->/, '')
    .replace(/<!--oce:case-hive-css-->[\s\S]*?<!--\/oce:case-hive-css-->/, '')
    .replace(/<!--oce:case-hive-->[\s\S]*?<!--\/oce:case-hive-->/, '')
    // Unwrap the layout wrappers back to bare elements so re-runs do not nest
    // them (the case-hive band inside was already stripped above). Both the
    // older hero-side wrapper and the current steps+modules body are handled.
    .replace(/<div class="dhero-side">(<div class="scene">[\s\S]*?<\/div>)\s*<\/div>/, '$1')
    .replace(/<div class="case-body">(<section class="steps">[\s\S]*?<\/section>)\s*<\/div>/, '$1');
  const slug = pb.id;

  const ch = !isEn ? CHROME[lang.code] : null;

  if (!isEn) {
    const langAttr = hreflangOf(lang);
    html = html.replace(
      '<html lang="en" data-theme="light">',
      `<html lang="${langAttr}"${lang.rtl ? ' dir="rtl"' : ''} data-theme="light">`,
    );

    const title = T(pb.titleKey, pb.titleDefault);
    const desc = T(pb.descKey, pb.descDefault);
    const metaDesc = truncMeta(desc);
    // Localize the "construction playbook" descriptor in the title / og:title
    // (highest-value SEO string); keep the product name untranslated.
    const descriptor = (ch && ch.descriptor) || 'construction playbook';
    const suffix = ` - ${descriptor} - OpenConstructionERP`;

    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escText(title)}${suffix}</title>`);
    html = html.replace(
      /<meta name="description" content="[\s\S]*?"\/>/,
      `<meta name="description" content="${escText(metaDesc)}"/>`,
    );
    html = html.replace(
      /<meta property="og:title" content="[\s\S]*?"\/>/,
      `<meta property="og:title" content="${escText(title)}${suffix}"/>`,
    );
    html = html.replace(
      /<meta property="og:description" content="[\s\S]*?"\/>/,
      `<meta property="og:description" content="${escText(metaDesc)}"/>`,
    );
    html = html.replace(
      /<link rel="canonical" href="[\s\S]*?"\/>/,
      `<link rel="canonical" href="${base}/${lang.code}/cases/${slug}"/>`,
    );

    // Category label: crumb, hero eyebrow, and the bare-<span> eyebrow on
    // every same-category related card. (The "More in <category>" heading
    // is handled in the chrome pass below so "More in" is localized too.)
    const cat = catById[pb.category];
    const catLabelT = cat ? T(cat.labelKey, cat.labelDefault) : null;
    if (cat) {
      const en = escText(cat.labelDefault);
      const tr = escText(catLabelT);
      if (tr !== en) {
        html = html.replace(
          new RegExp('(<div class="crumb"><a href="/cases">Cases</a> / )' + escRe(en) + '(</div>)'),
          `$1${tr}$2`,
        );
        html = html.replace(
          new RegExp('(<span style="margin-left:2px">)' + escRe(en) + '(</span>)'),
          `$1${tr}$2`,
        );
        html = html.split(`<span>${en}</span>`).join(`<span>${tr}</span>`);
      }
    }

    // Company-type pills.
    for (const ctId of pb.companyTypes || []) {
      const cm = compById[ctId];
      if (!cm) continue;
      const en = escText(cm.labelDefault);
      const tr = escText(T(cm.labelKey, cm.labelDefault));
      if (tr !== en) html = html.split(`<span class="pill">${en}</span>`).join(`<span class="pill">${tr}</span>`);
    }

    // Hero title + lede.
    html = html.replace(
      new RegExp('<h1>' + escRe(escText(pb.titleDefault)) + '</h1>'),
      `<h1>${escText(title)}</h1>`,
    );
    html = html.replace(
      new RegExp('(<p class="dlede">)' + escRe(escText(pb.descDefault)) + '(</p>)'),
      `$1${escText(desc)}$2`,
    );

    // Steps: title, what, why, module chip, flow chips.
    for (const s of pb.steps) {
      html = html.replace(
        new RegExp('<h3>' + escRe(escText(s.titleDefault)) + '</h3>'),
        `<h3>${escText(T(s.titleKey, s.titleDefault))}</h3>`,
      );
      html = html.replace(
        new RegExp('(<p class="what">)' + escRe(escText(s.whatDefault)) + '(</p>)'),
        `$1${escText(T(s.whatKey, s.whatDefault))}$2`,
      );
      html = html.replace(
        new RegExp('(<b>Why:</b> )' + escRe(escText(s.whyDefault)) + '(</p>)'),
        `$1${escText(T(s.whyKey, s.whyDefault))}$2`,
      );
      if (s.moduleLabel) {
        const en = escText(s.moduleLabel);
        const tr = escText(s.moduleLabelKey ? T(s.moduleLabelKey, s.moduleLabel) : s.moduleLabel);
        if (tr !== en) html = html.split(`</svg>${en}</span>`).join(`</svg>${tr}</span>`);
      }
      for (const fi of [...(s.inputs || []), ...(s.outputs || [])]) {
        if (!fi || !fi.label) continue;
        const en = escText(fi.label);
        const tr = escText(fi.labelKey ? T(fi.labelKey, fi.label) : fi.label);
        if (tr !== en) html = html.split(`<span class="fchip">${en}</span>`).join(`<span class="fchip">${tr}</span>`);
      }
    }

    // Related / next cards: translate sibling title + blurb (anchored on
    // the sibling's own /cases/<slug> link so each match is unique),
    // then point every detail link at the localized URL.
    const sibSlugs = new Set();
    for (const m of html.matchAll(/href="\/cases\/([a-z0-9-]+)"/g)) {
      if (m[1] !== slug) sibSlugs.add(m[1]);
    }
    for (const sib of sibSlugs) {
      const sp = pbById[sib];
      if (!sp) continue;
      const enTitle = escText(sp.titleDefault);
      const trTitle = escText(T(sp.titleKey, sp.titleDefault));
      const trBlurb = escText(truncCard(T(sp.descKey, sp.descDefault)));
      html = html.replace(
        new RegExp(
          '(href="/cases/' + escRe(sib) + '"[\\s\\S]*?<h3>)' + escRe(enTitle) + '(</h3><p>)[\\s\\S]*?(</p>)',
        ),
        `$1${trTitle}$2${trBlurb}$3`,
      );
    }
    // ---- template chrome (fixed UI strings with no case-content key) ----
    // Reuse app locale keys where they exist (steps pill, flow In/Out, the
    // Why label, card Open, nav Cases/Docs); the rest come from the
    // localized chrome table. English chrome has no entry here, so English
    // pages keep the original template strings verbatim.
    if (ch) {
      const R = (s) => escText(s);
      // "N steps" pills + related-card foot -> localized via cases.card.steps.
      const stepsTpl = T('cases.card.steps', '{{count}} steps');
      html = html.replace(
        /<\/svg>(\d+) steps<\/span>/g,
        (_m, n) => `</svg>${escText(stepsTpl.replace(/\{\{count\}\}/g, n))}</span>`,
      );
      // "N min" pills/foot -> localized minute unit.
      html = html.replace(/<\/svg>(\d+) min<\/span>/g, (_m, n) => `</svg>${n} ${R(ch.min)}</span>`);
      // Steps section heading + subtitle (subtitle carries the step count).
      html = html.replace(
        /<h2 class="steps-h">[\s\S]*?<\/h2>/,
        `<h2 class="steps-h">${R(ch.stepByStep)}</h2>`,
      );
      html = html.replace(
        /<p class="steps-sub">[\s\S]*?<\/p>/,
        `<p class="steps-sub">${R(ch.sub.replace('{n}', String(pb.steps.length)))}</p>`,
      );
      // "Why:" label (reuse cases.step.why + colon).
      html = html.split('<b>Why:</b>').join(`<b>${R(T('cases.step.why', 'Why'))}:</b>`);
      // Flow In / Out labels (reuse cases.flow.in / cases.flow.out).
      html = html.split('<span class="lab">In</span>').join(`<span class="lab">${R(T('cases.flow.in', 'In'))}</span>`);
      html = html.split('<span class="lab">Out</span>').join(`<span class="lab">${R(T('cases.flow.out', 'Out'))}</span>`);
      // CTA buttons.
      html = html.split('</svg>Open demo</a>').join(`</svg>${R(ch.openDemo)}</a>`);
      html = html.split('</svg>Try it in the demo</a>').join(`</svg>${R(ch.tryDemo)}</a>`);
      html = html.split('</svg>Open this workflow in the demo</a>').join(`</svg>${R(ch.openWorkflow)}</a>`);
      html = html.split('href="/cases">Browse all cases</a>').join(`href="/cases">${R(ch.browseAll)}</a>`);
      // Related-card "Open" (reuse cases.card.open).
      html = html.split('<span class="go">Open<svg').join(`<span class="go">${R(T('cases.card.open', 'Open'))}<svg`);
      // Nav + crumb "Cases" (reuse nav.cases); nav + footer "Docs" (reuse nav.docs).
      const casesTr = R(T('nav.cases', 'Cases'));
      html = html.split('<a href="/cases">Cases</a>').join(`<a href="/cases">${casesTr}</a>`);
      const docsTr = R(T('nav.docs', 'Docs'));
      html = html.split('<a href="/docs">Docs</a>').join(`<a href="/docs">${docsTr}</a>`);
      // (The top-nav Tour/Compare/Pricing/News/Uberization labels live only in
      // the header, which is replaced wholesale by the cloned homepage nav
      // below, so they are baked there rather than substituted here.)
      // "More in <category>" related heading (category label already translated).
      if (catLabelT != null) {
        html = html.replace(
          /<h2 class="rel-h">More in [\s\S]*?<\/h2>/,
          `<h2 class="rel-h">${R(ch.moreIn.replace('{cat}', catLabelT))}</h2>`,
        );
      }
      // Footer tagline + links.
      html = html.replace(
        /<div>Guided construction playbooks - part of the OpenConstructionERP platform.<\/div>/,
        `<div>${R(ch.footerTagline)}</div>`,
      );
      html = html.split('<a href="/">Home</a>').join(`<a href="/">${R(ch.footHome)}</a>`);
      html = html.split('<a href="/cases">All cases</a>').join(`<a href="/cases">${R(ch.footAllCases)}</a>`);
      html = html.split('<a href="/demo">Live demo</a>').join(`<a href="/demo">${R(ch.footLiveDemo)}</a>`);
    }

    // Localize detail links (leave the /cases index link untouched).
    html = html.split('href="/cases/').join(`href="/${lang.code}/cases/`);
  }

  // Replace the template header with a per-language clone of the homepage nav
  // (labels + link targeting baked in). Done for every language, as the last
  // structural edit so no earlier substitution touches it. A function
  // replacement keeps `$` sequences in the markup literal.
  const header = buildHeader(lang, T, ch, slug);
  html = html.replace(/<header\b[\s\S]*?<\/header>/, () => header);

  // The header's CSS + theme-init + interaction JS (one-time, marked blocks).
  html = injectNavAssets(html);

  // Inject the SEO head cluster just before </head>, for every language.
  html = html.replace('</head>', `${seoBlock(base, slug, lang, T, pb)}</head>`);

  // Module honeycomb: this case's modules as solid hexes ringed by ghosts.
  // Same component + data as the gallery; module names stay English, the
  // heading text is localized (English default when a language is absent).
  const hiveMods = MODULES_RAW[slug]
    ? normModules(MODULES_RAW[slug])
    : normModules((pb.steps || []).map((s) => s.moduleLabel).filter(Boolean));
  const catAccent = catById[pb.category] && catById[pb.category].accent;
  const hiveColor = (catAccent && (catAccent.base || catAccent)) || '#0284c7';
  // Clicking a hex lands on the gallery filtered to that module. Use this
  // language's localized gallery when one exists, else the English gallery.
  const filterBase = LOCALIZED_GALLERY.has(lang.code) ? `/${lang.code}/cases` : '/cases';
  const hiveBand = buildCaseHive({
    mods: hiveMods,
    color: hiveColor,
    eyebrow: (ch && ch.modulesEyebrow) || 'Modules',
    title: (ch && ch.modulesTitle) || 'Modules in this playbook',
    noteTpl: (ch && ch.modulesNote) || '{n} / {total} platform modules',
    filterBase,
  });
  // The shared core CSS carries the hex component, the language-switcher
  // styling and the white page canvas, so inject it on every page (not only
  // when the band lands).
  html = html.replace('</head>', `${CASE_HIVE_CSS_BLOCK}</head>`);
  if (hiveBand) {
    // Pair the honeycomb with the steps section: steps on the left, the
    // compact modules panel as a slim vertical column on the right. On narrow
    // screens the panel stacks under the steps (see .case-body media query).
    // If a page has no steps section, fall back to an in-flow band before
    // </main> so the panel still shows.
    const before = html;
    html = html.replace(
      /<section class="steps">[\s\S]*?<\/section>/,
      (steps) => `<div class="case-body">${steps}${hiveBand}</div>`,
    );
    if (html === before) {
      html = html.replace('</main>', `${hiveBand}</main>`);
    }
  }

  if (!isEn && stats) {
    if (missing > 0) {
      stats.langMissing[lang.code] = (stats.langMissing[lang.code] || 0) + missing;
      (stats.caseMissing[slug] ||= {})[lang.code] = missing;
    }
  }
  return html;
}

// ---- main ------------------------------------------------------

let pbById = {};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const casesDir = join(MARKETING_ROOT, 'cases');
  if (!existsSync(casesDir)) {
    console.error(`generate-cases: English cases dir not found: ${casesDir}`);
    process.exit(1);
  }

  const { playbooks, categories, companies } = await loadData();
  const locales = await loadLocales();
  pbById = Object.fromEntries(playbooks.map((p) => [p.id, p]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const compById = Object.fromEntries(companies.map((c) => [c.id, c]));

  const targetLangs = args.lang ? LANGS.filter((l) => l.code === args.lang) : LANGS;

  const stats = {
    en: 0,
    perLang: {},
    langMissing: {},
    caseMissing: {},
    missingPages: [],
  };

  for (const pb of playbooks) {
    const slug = pb.id;
    const enPath = join(casesDir, `${slug}.html`);
    if (!existsSync(enPath)) {
      stats.missingPages.push(slug);
      continue;
    }
    const rawEnglish = readFileSync(enPath, 'utf8');

    // English page: strip + re-inject the SEO block (content unchanged).
    const enHtml = buildPage({
      rawEnglish,
      pb,
      lang: { code: 'en', og: 'en_US' },
      base: args.base,
      locales,
      catById,
      compById,
      stats,
    });
    if (!args.dryRun) writeFileSync(enPath, enHtml);
    stats.en++;

    for (const lang of targetLangs) {
      const html = buildPage({ rawEnglish, pb, lang, base: args.base, locales, catById, compById, stats });
      const outDir = join(MARKETING_ROOT, lang.code, 'cases');
      const outPath = join(outDir, `${slug}.html`);
      if (!args.dryRun) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(outPath, html);
      }
      stats.perLang[lang.code] = (stats.perLang[lang.code] || 0) + 1;
    }
  }

  // ---- report ----
  const langCount = targetLangs.length;
  const localizedTotal = Object.values(stats.perLang).reduce((a, b) => a + b, 0);
  console.log(`${args.dryRun ? '[dry-run] ' : ''}cases generator`);
  console.log(`  base: ${args.base}`);
  console.log(`  English pages (SEO head injected): ${stats.en}`);
  console.log(`  languages: ${langCount} (${targetLangs.map((l) => l.code).join(', ')})`);
  console.log(`  localized pages written: ${localizedTotal} (${stats.en} x ${langCount} target langs)`);
  console.log(`  total pages incl. English: ${stats.en + localizedTotal}`);
  if (stats.missingPages.length) {
    console.log(`  WARNING no English template for ${stats.missingPages.length}: ${stats.missingPages.join(', ')}`);
  }
  const missingLangs = Object.entries(stats.langMissing).sort((a, b) => b[1] - a[1]);
  if (missingLangs.length) {
    console.log('  fallbacks to English (missing locale keys), by language:');
    for (const [code, n] of missingLangs) console.log(`    ${code}: ${n} strings`);
  } else {
    console.log('  fallbacks to English: none (every string translated in every language)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
