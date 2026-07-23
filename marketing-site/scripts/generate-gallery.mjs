/*
 * generate-gallery.mjs  (idempotent gallery generator)
 *
 * Rebuilds the /cases gallery page (cases/index.html) with two changes:
 *
 *   1. Homepage navigation. The slim legacy <header class="hd"> is swapped
 *      for a clone of the homepage top nav (class="nav", styled by
 *      cases-nav.css, with theme-toggle + burger). The clone, its CSS and
 *      its wiring script are lifted verbatim from a case detail page
 *      (cases/answer-an-rfi.html) so the two stay in sync. The "Cases"
 *      link is marked active.
 *
 *   2. Contextual honeycomb-on-hover. The card grid runs full width (no
 *      side panel, no detached hero band). A single fixed, click-through
 *      overlay follows the pointer: hovering or focusing a card blooms
 *      that case's modules as solid hexes right beside THAT card, ringed
 *      by the platform's OTHER modules as faint ghost hexes - so the
 *      selection reads as a few picks out of many available modules.
 *      Per-case module lists come from scripts/case-modules.json; each
 *      card carries a data-modules="A|B|C" attribute the runtime reads.
 *      The global module vocabulary (the ghost pool) is derived from
 *      every card at runtime.
 *
 * Everything is injected between HTML-comment sentinels, so re-running the
 * generator produces a byte-identical file (idempotent). Run it from the
 * repo root or anywhere: paths resolve from this file's location.
 *
 *   node marketing-site/scripts/generate-gallery.mjs
 *
 * Plain Node ESM, no dependencies beyond node:fs / node:path.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import {
  buildSwitcher,
  galleryHref,
  SWITCHER_JS,
  SWITCH_LANGS,
} from './cases-switcher.mjs';
import { CHROME, NAV_PILL, GALLERY_CHROME, GALLERY_CHROME_EN } from './cases-chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '..');
const REPO_ROOT = resolve(SITE, '..');
const GALLERY = join(SITE, 'cases', 'index.html');
const DETAIL = join(SITE, 'cases', 'answer-an-rfi.html');
const MODULES_JSON = join(here, 'case-modules.json');
const HIVE_CSS = join(here, 'cases-hive.css');

// Locale-file basename per switcher language (all match the URL code today).
const TS_OF = { 'es-mx': 'es-MX' };
const tsOf = (code) => TS_OF[code] || code;

/* ---- text helpers (match the detail generator / React escaping) ------ */
// Escape identical to React's renderToStaticMarkup, so a translated string
// swapped in matches the committed English gallery byte conventions.
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
// Hard slice with an ellipsis, mirroring the gallery's own card blurbs.
function truncate(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+$/, '') + '…';
}

/* ---- esbuild-backed loaders (reuse the app's own case data + locales) - */
// The card titles / blurbs, discipline labels and role labels shown on the
// gallery are the SAME strings the app already translates (cases.<slug>.*,
// cases.cat.*, cases.company.*). We read those translations straight from
// the app locale files and reuse them, so no separate translation store is
// needed for the bulk of the page. Only the gallery-only chrome (hero,
// title, search box, etc.) comes from GALLERY_CHROME. Loading is best-effort:
// if esbuild or the app sources are unavailable, the gallery still builds
// with English card copy.
let TMP;
function tmpFile(name) {
  if (!TMP) {
    TMP = join(tmpdir(), `oce-gallery-${process.pid}`);
    mkdirSync(TMP, { recursive: true });
  }
  return join(TMP, name);
}
async function bundleImport(entrySource, resolveDir, outName) {
  const require = createRequire(join(REPO_ROOT, 'frontend', 'package.json'));
  const esbuild = require('esbuild');
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
// Non-English switcher languages get a localized gallery snapshot.
const SNAP_LANGS = SWITCH_LANGS.filter((l) => l.code !== 'en');

async function loadContent() {
  const dataDir = join(REPO_ROOT, 'frontend/src/features/cases/data');
  const catsPath = join(REPO_ROOT, 'frontend/src/features/cases/categories.ts');
  const compPath = join(REPO_ROOT, 'frontend/src/features/cases/companyTypes.ts');
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.playbook.ts')).sort();
  const imports = files
    .map((f, i) => `import pb_${i} from ${JSON.stringify(join(dataDir, f))};`)
    .join('\n');
  const arr = files.map((_, i) => `pb_${i}`).join(',');
  const dataEntry = `${imports}
import { CATEGORY_META } from ${JSON.stringify(catsPath)};
import { COMPANY_TYPE_META } from ${JSON.stringify(compPath)};
export const playbooks = [${arr}].map((p) => ({ id: p.id, titleKey: p.titleKey, titleDefault: p.titleDefault, descKey: p.descKey, descDefault: p.descDefault }));
export const categories = CATEGORY_META.map((c) => ({ id: c.id, labelKey: c.labelKey, labelDefault: c.labelDefault }));
export const companies = COMPANY_TYPE_META.map((c) => ({ id: c.id, labelKey: c.labelKey, labelDefault: c.labelDefault }));
`;
  const data = await bundleImport(dataEntry, dataDir, 'gallery-data.mjs');

  const localesDir = join(REPO_ROOT, 'frontend/src/app/locales');
  const rows = SNAP_LANGS.map((l, i) => `import loc_${i} from ${JSON.stringify(join(localesDir, tsOf(l.code) + '.ts'))};`);
  const map = SNAP_LANGS.map((l, i) => `${JSON.stringify(l.code)}: loc_${i}.translation`).join(',');
  const locEntry = `${rows.join('\n')}\nexport const locales = { ${map} };\n`;
  const loc = await bundleImport(locEntry, localesDir, 'gallery-locales.mjs');

  return {
    pbById: Object.fromEntries(data.playbooks.map((p) => [p.id, p])),
    categories: data.categories,
    companies: data.companies,
    locales: loc.locales,
  };
}

/* ---- module-label normalisation ------------------------------------- */
// Fold obvious duplicate / case-variant labels to a single clean form.
const CANON = {
  'take-off': 'Takeoff',
  'takeoff': 'Takeoff',
  'daily diary': 'Daily Diary',
  'rfi': 'RFIs',
  'rfis': 'RFIs',
  'bim viewer': 'BIM Viewer',
  'advanced schedule': 'Advanced Schedule',
  'advanced scheduling': 'Advanced Schedule',
  'schedule advanced': 'Advanced Schedule',
  'non-conformance': 'Non-conformances',
  'non-conformances': 'Non-conformances',
  'project files': 'Project Files',
};

function canon(label) {
  const key = String(label).trim().toLowerCase();
  return CANON[key] || String(label).trim();
}

// Normalise a case's module list: canonicalise then dedupe (order kept).
function normModules(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const c = canon(raw);
    const k = c.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/* ---- lift a delimited block out of a source file -------------------- */
function slice(src, re, label) {
  const m = src.match(re);
  if (!m) throw new Error(`Could not find ${label} in the detail page`);
  return m[0];
}

// Place the language switcher just before the burger inside .nav-right, so
// it sits with the demo / GitHub / install pills like the homepage picker.
function injectSwitcher(navHtml, switchBlock) {
  if (navHtml.includes('<button type="button" class="nav-burger"')) {
    return navHtml.replace(
      '<button type="button" class="nav-burger"',
      switchBlock + '\n        <button type="button" class="nav-burger"',
    );
  }
  // Fallback: append inside the first nav-right container.
  return navHtml.replace('</div>\n      </div>\n    </div>\n  </nav>', switchBlock + '</div>\n      </div>\n    </div>\n  </nav>');
}

/* ---- hero decorative honeycomb (baked, static) ---------------------- */
// A small icon set mirroring the runtime hover map, so the hero motif reads
// with the same glyphs. Unknown names fall back to a first letter.
const HERO_ICONS = {
  boq: '☰', costs: '€', takeoff: '✶', validation: '✓',
  schedule: '◷', 'advanced schedule': '◷', bim: '◈', 'bim viewer': '◈',
  'production norms': '∑', 'resource summary': '▦', tendering: '⎙',
  procurement: '⛟', handover: '⚑', projects: '◫', reports: '▤',
  portal: '◧', assemblies: '❏', 'daily diary': '✎', rfis: '?',
  'non-conformances': '⚠', 'punch list': '☑', files: '▦',
};
function heroIcon(name) {
  const k = String(name).toLowerCase().trim();
  if (HERO_ICONS[k]) return HERO_ICONS[k];
  for (const key of Object.keys(HERO_ICONS)) if (k.indexOf(key) >= 0) return HERO_ICONS[key];
  const m = String(name).replace(/[^A-Za-z0-9]/g, '');
  return m ? m.charAt(0).toUpperCase() : '◆';
}
function heroSpiral(radius) {
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
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the hero aside: a radius-2 hex cluster of representative modules
// (a few solid picks ringed by ghost hexes), tinted the gallery accent.
function buildHeroHive() {
  const solids = ['BOQ', 'Takeoff', 'Costs', 'Schedule', 'Reports', 'Projects'];
  const ghosts = ['Tendering', 'Procurement', 'Handover', 'Portal', 'Validation',
    'BIM Viewer', 'Assemblies', 'Daily Diary', 'RFIs', 'Punch List',
    'Files', 'Resource Summary', 'Production Norms'];
  const cells = heroSpiral(2); // 19 seats
  const tint = '#0284c7';
  const w = 64, h = w * 0.866, col = w * 0.75;
  const seats = cells.map((c) => ({ x: c.q * col, y: h * (c.r + c.q / 2) }));
  const xs = seats.map((s) => s.x), ys = seats.map((s) => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + w;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + h;
  const cw = maxX - minX, chh = maxY - minY;
  const n = solids.length;
  const parts = seats.map((s, i) => {
    const x = (s.x - minX).toFixed(1), y = (s.y - minY).toFixed(1);
    const dur = (6 + ((i * 7) % 5) * 0.6).toFixed(1);
    const del = ((i % 6) * 0.35).toFixed(2);
    const style = `left:${x}px;top:${y}px;--tint:${tint};--dur:${dur}s;--del:${del}s`;
    if (i < n) {
      const nm = solids[i];
      return `<span class="hc-cell" style="${style}" title="${escHtml(nm)}">` +
        `<span class="hc-face"><span class="hc-ico" aria-hidden="true">${heroIcon(nm)}</span>` +
        `<span class="hc-title">${escHtml(nm)}</span></span></span>`;
    }
    const nm = ghosts[i - n] || '';
    return `<span class="hc-ghost" style="${style}" title="${escHtml(nm)}">` +
      `<span class="hc-gface"><span class="hc-gico" aria-hidden="true">${heroIcon(nm)}</span></span></span>`;
  }).join('');
  return `<aside class="hero-hive" aria-hidden="true" style="width:${cw.toFixed(0)}px;height:${chh.toFixed(0)}px;` +
    `--hc-w:${w}px;--hc-h:${h.toFixed(1)}px">${parts}</aside>`;
}

/* ---- localize the nav chrome text on a snapshot ---------------------- */
// The gallery header is lifted verbatim (in English) from the detail-page
// template, so every /<lang>/cases snapshot used to keep the English nav
// labels no matter which language it was for - the switcher correctly
// navigated to /<lang>/cases, but the header itself never actually read
// as that language. Detail pages already solve this with the CHROME /
// NAV_PILL tables (see cases-chrome.mjs); reuse the exact same tables here
// so the gallery header matches the language a visitor lands on. "Cases"
// and "Docs" are left in English: those two reuse the app's own nav.cases
// / nav.docs locale keys on detail pages, which this lightweight generator
// does not load (no bundler dependency here by design).
function localizeNavText(pageHtml, code) {
  const ch = CHROME[code];
  const pill = NAV_PILL[code];
  if (!ch && !pill) return pageHtml;
  let out = pageHtml;
  const swap = (oldStr, newStr) => {
    if (!newStr || newStr === oldStr) return;
    out = out.split(oldStr).join(newStr);
  };
  if (ch) {
    swap('>Tour<', `>${escHtml(ch.navTour)}<`);
    swap('>Compare<', `>${escHtml(ch.navCompare)}<`);
    swap('>Pricing<', `>${escHtml(ch.navPricing)}<`);
    swap('>News<', `>${escHtml(ch.navNews)}<`);
    swap('>Uberization<', `>${escHtml(ch.navUberization)}<`);
  }
  if (pill) {
    swap('<span>Demo</span>', `<span>${escHtml(pill.demo)}</span>`);
    swap('<span>Download</span>', `<span>${escHtml(pill.download)}</span>`);
  }
  return out;
}

/* ---- localize one gallery snapshot's content ------------------------ */
// Swap the card titles / blurbs, the discipline chip + eyebrow labels, the
// role options, the footer, the nav Cases/Docs and the gallery-only chrome
// into `code`. Card copy and labels reuse the app's own translations; the
// gallery-only chrome comes from GALLERY_CHROME (field-by-field English
// fallback). Returns the localized page; leaves untranslatable runs as-is.
function localizeContent(lp, code, ctx) {
  if (!ctx) return lp;
  const { pbById, categories, companies, locales, cards, count } = ctx;
  const m = locales[code];
  const T = (key, def) => {
    const v = m ? m[key] : undefined;
    return v == null || v === '' ? def : v;
  };
  const cjk = ['zh', 'ja', 'ko', 'th'].includes(code);
  const budget = cjk ? 46 : 92;

  // Card title + blurb, anchored on the card's own /cases/<slug> link so each
  // match is unique. Blurb reuses the translated description, re-truncated.
  for (const c of cards) {
    const pb = pbById[c.slug];
    if (!pb) continue;
    const trTitle = escText(T(pb.titleKey, pb.titleDefault));
    const trBlurb = escText(truncate(T(pb.descKey, pb.descDefault), budget));
    lp = lp.replace(
      new RegExp('(href="/cases/' + escRe(c.slug) + '"[\\s\\S]*?<h3>)' + escRe(c.enTitle) + '(</h3><p>)' + escRe(c.enBlurb) + '(</p>)'),
      (_m, a, b, d) => `${a}${trTitle}${b}${trBlurb}${d}`,
    );
  }
  // Discipline chip + card eyebrow labels (reuse cases.cat.*).
  for (const cat of categories) {
    const en = escText(cat.labelDefault);
    const tr = escText(T(cat.labelKey, cat.labelDefault));
    if (tr !== en) lp = lp.split(en).join(tr);
  }
  // Role select options (reuse cases.company.*).
  for (const comp of companies) {
    const en = escText(comp.labelDefault);
    const tr = escText(T(comp.labelKey, comp.labelDefault));
    if (tr !== en) lp = lp.split(en).join(tr);
  }
  // Nav + crumb "Cases" and footer "Docs" (reuse nav.cases / nav.docs).
  const casesTr = escText(T('nav.cases', 'Cases'));
  if (casesTr !== 'Cases') lp = lp.split('>Cases</a>').join(`>${casesTr}</a>`);
  const docsTr = escText(T('nav.docs', 'Docs'));
  if (docsTr !== 'Docs') lp = lp.split('>Docs</a>').join(`>${docsTr}</a>`);
  // Footer tagline + links (reuse CHROME).
  const ch = CHROME[code];
  if (ch) {
    lp = lp.replace(
      '<div>Guided construction playbooks - part of the OpenConstructionERP platform.</div>',
      `<div>${escText(ch.footerTagline)}</div>`,
    );
    lp = lp.split('<a href="/">Home</a>').join(`<a href="/">${escText(ch.footHome)}</a>`);
    lp = lp.split('<a href="/cases">All cases</a>').join(`<a href="/cases">${escText(ch.footAllCases)}</a>`);
    lp = lp.split('<a href="/demo">Live demo</a>').join(`<a href="/demo">${escText(ch.footLiveDemo)}</a>`);
  }

  // Gallery-only chrome: each field falls back to the English gallery text
  // (no swap) when GALLERY_CHROME lacks it, so a partly filled language still
  // renders correctly and the English page is never touched.
  const gc = GALLERY_CHROME[code] || {};
  const n = String(count);
  if (gc.metaTitle) {
    const t = `${escText(gc.metaTitle)} - OpenConstructionERP`;
    lp = lp.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`);
    lp = lp.replace(/<meta property="og:title" content="[\s\S]*?"\/>/, `<meta property="og:title" content="${t}"/>`);
  }
  if (gc.metaDescTpl) {
    const d = escText(gc.metaDescTpl.replace(/\{n\}/g, n));
    lp = lp.replace(/<meta name="description" content="[\s\S]*?"\/>/, `<meta name="description" content="${d}"/>`);
    lp = lp.replace(/<meta property="og:description" content="[\s\S]*?"\/>/, `<meta property="og:description" content="${d}"/>`);
  }
  if (gc.heroEyebrow) {
    lp = lp.replace(/<span class="eyebrow">[\s\S]*?<\/span>/, `<span class="eyebrow">${escText(gc.heroEyebrow)}</span>`);
  }
  if (gc.heroTitleTpl) {
    // Keeps the translator-provided <span class="it">..</span> emphasis run.
    lp = lp.replace(/<h1 class="title">[\s\S]*?<\/h1>/, `<h1 class="title">${gc.heroTitleTpl.replace(/\{n\}/g, n)}</h1>`);
  }
  if (gc.heroLede) {
    lp = lp.replace(/<p class="lede">[\s\S]*?<\/p>/, `<p class="lede">${escText(gc.heroLede)}</p>`);
  }
  if (gc.metaPlaybooks) lp = lp.split('</b> playbooks</span>').join(`</b> ${escText(gc.metaPlaybooks)}</span>`);
  if (gc.metaDisciplines) lp = lp.split('</b> disciplines</span>').join(`</b> ${escText(gc.metaDisciplines)}</span>`);
  if (gc.metaSteps) lp = lp.split('</b> guided steps</span>').join(`</b> ${escText(gc.metaSteps)}</span>`);
  if (gc.metaDemoTpl) lp = lp.split('<span>Open any one in the <b>live demo</b></span>').join(`<span>${gc.metaDemoTpl}</span>`);
  if (gc.searchPlaceholder) lp = lp.replace(/placeholder="[^"]*"/, `placeholder="${escText(gc.searchPlaceholder)}"`);
  if (gc.empty) lp = lp.split('No playbooks match. Try a different word or clear the filters.').join(escText(gc.empty));
  if (gc.chipAll) lp = lp.split('>All<span class="ct">').join(`>${escText(gc.chipAll)}<span class="ct">`);
  if (gc.roleLabel) lp = lp.split('>I work as</span>').join(`>${escText(gc.roleLabel)}</span>`);
  if (gc.roleAny) lp = lp.split('<option value="all">Any role</option>').join(`<option value="all">${escText(gc.roleAny)}</option>`);
  if (gc.countWord) {
    lp = lp.split("(shown===1?' playbook':' playbooks')").join("(' '+" + JSON.stringify(gc.countWord) + ')');
  }
  return lp;
}

/* ==================================================================== */
async function main() {
  let html = readFileSync(GALLERY, 'utf8');
  const detail = readFileSync(DETAIL, 'utf8');
  const modulesRaw = JSON.parse(readFileSync(MODULES_JSON, 'utf8'));
  const hiveCss = readFileSync(HIVE_CSS, 'utf8');

  // Lift the homepage-nav pieces from the detail page so they stay in sync.
  const navCss = slice(detail, /<style id="oce-cases-nav-css">[\s\S]*?<\/style>/, 'cases-nav.css block');
  const themeInit = slice(detail, /<!--oce:nav-theme-init-->[\s\S]*?<!--\/oce:nav-theme-init-->/, 'theme-init script');
  let navHtml = slice(detail, /<header class="oce-hd">[\s\S]*?<\/header>/, 'nav header markup');
  const navJs = slice(detail, /<!--oce:nav-js-->[\s\S]*?<!--\/oce:nav-js-->/, 'nav wiring script');

  // Mark the Cases link active in the desktop nav-links slot.
  navHtml = navHtml.replace(
    '<a href="/cases">Cases</a>',
    '<a href="/cases" class="is-active" aria-current="page">Cases</a>',
  );

  // Drop any switcher lifted from the detail page and inject the gallery's
  // own (its links point at /<lang>/cases, not a detail slug). English page:
  // the button reads EN; every menu item navigates to that language's gallery.
  navHtml = navHtml.replace(/<!--oce:lang-switch-->[\s\S]*?<!--\/oce:lang-switch-->/, '');
  const gallerySwitch = '<!--oce:lang-switch-->' + buildSwitcher('en', galleryHref()) + '<!--/oce:lang-switch-->';
  navHtml = injectSwitcher(navHtml, gallerySwitch);

  /* ---- (1) head block: nav CSS + theme init + hive CSS ------------- */
  const headBlock =
    '<!--oce:gallery-head-->' +
    navCss +
    themeInit +
    '<style id="oce-hive-css">\n' + hiveCss + '\n</style>' +
    '<!--/oce:gallery-head-->';
  html = html.replace(
    /<!--oce:gallery-head-->[\s\S]*?<!--\/oce:gallery-head-->\s*<\/head>|<\/head>/,
    headBlock + '</head>',
  );

  /* ---- (2) header: swap the slim header for the homepage nav ------- */
  const navBlock = '<!--oce:gallery-nav-->' + navHtml + '<!--/oce:gallery-nav-->';
  html = html.replace(
    /<!--oce:gallery-nav-->[\s\S]*?<!--\/oce:gallery-nav-->|<header class="hd">[\s\S]*?<\/header>/,
    navBlock,
  );

  /* ---- (2b) hero: balanced blocks + decorative honeycomb ---------- */
  // Rebuild the hero as evenly balanced, equal-height blocks (eyebrow +
  // headline, description, stats) with the decorative honeycomb on the
  // right, on a seamless background (no panel/border). Re-extracting each
  // original piece by its own selector keeps this idempotent whether or not
  // a prior run already wrapped them.
  html = html.replace(/<section class="hero">[\s\S]*?<\/section>/, (heroFull) => {
    const grab = (re) => { const m = heroFull.match(re); return m ? m[0] : ''; };
    const eyebrow = grab(/<span class="eyebrow">[\s\S]*?<\/span>/);
    const title = grab(/<h1 class="title">[\s\S]*?<\/h1>/);
    const lede = grab(/<p class="lede">[\s\S]*?<\/p>/);
    const meta = grab(/<div class="hero-meta">[\s\S]*?<\/div>/);
    return (
      '<section class="hero"><!--oce:hero-->' +
      '<div class="hero-lead">' + eyebrow + title + '</div>' +
      '<div class="hero-lede">' + lede + '</div>' +
      meta +
      buildHeroHive() +
      '<!--/oce:hero--></section>'
    );
  });

  /* ---- (3) data-modules on every card ----------------------------- */
  // Strip any prior data-modules (only card tags carry it) then re-add fresh,
  // so the step is idempotent regardless of where the attribute sat.
  html = html.replace(/ data-modules="[^"]*"/g, '');
  let carded = 0;
  const missing = [];
  html = html.replace(/<a class="card" href="\/cases\/([^"]+)"/g, (m, slug) => {
    const raw = modulesRaw[slug];
    if (!raw) {
      missing.push(slug);
      return m;
    }
    carded += 1;
    const mods = normModules(raw);
    const attr = ' data-modules="' + mods.join('|').replace(/"/g, '&quot;') + '"';
    return m + attr;
  });

  /* ---- (3b) insert the click-through honeycomb overlay ------------ */
  // A single fixed overlay; the runtime positions its cluster next to the
  // hovered card. aria-hidden: it is a decorative echo of the card, and
  // the module list is already spoken by the card's own text.
  const overlayHtml =
    '<div class="hive-overlay" id="hiveGrid" aria-hidden="true"></div>';

  const hiveRe = new RegExp(
    '<main class="wrap">' +
    '(?:<!--oce:gallery-hive-->[\\s\\S]*?)?' +
    '(<div class="count" id="count"></div>)' +
    '(<div class="grid" id="grid">[\\s\\S]*?</div>)(?=<div class="empty" id="empty">)' +
    '(<div class="empty" id="empty">[\\s\\S]*?</div>)' +
    '[\\s\\S]*?</main>',
  );
  if (!hiveRe.test(html)) throw new Error('Could not locate the card area (<main> + count + grid + empty)');
  html = html.replace(hiveRe, (_full, count, grid, empty) =>
    '<main class="wrap"><!--oce:gallery-hive-->' + overlayHtml +
    '<div class="cases-grid-wide">' + count + grid + empty + '</div>' +
    '<!--/oce:gallery-hive--></main>',
  );

  /* ---- (4) hover script + nav wiring + switcher before </body> ---- */
  const switchJs = '<script>' + SWITCHER_JS + '</script>';
  const jsBlock = '<!--oce:gallery-js-->' + HIVE_SCRIPT + navJs + switchJs + '<!--/oce:gallery-js-->';
  html = html.replace(
    /<!--oce:gallery-js-->[\s\S]*?<!--\/oce:gallery-js-->\s*<\/body>|<\/body>/,
    jsBlock + '</body>',
  );

  writeFileSync(GALLERY, html);

  /* ---- (4b) load the app's case translations (best-effort) --------- */
  // Reuse the app's own translated case titles / blurbs, discipline labels
  // and role labels for the localized snapshots. If the app sources or
  // esbuild are unavailable, fall back to English card copy and still emit
  // the snapshots (nav chrome is localized regardless).
  let content = null;
  const cards = [];
  for (const m of html.matchAll(/<a class="card" href="\/cases\/([a-z0-9-]+)"[\s\S]*?<h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p>/g)) {
    cards.push({ slug: m[1], enTitle: m[2], enBlurb: m[3] });
  }
  try {
    const loaded = await loadContent();
    content = { ...loaded, cards, count: cards.length };
  } catch (e) {
    console.log(`Case translations unavailable, localized cards stay English: ${e.message}`);
  }

  /* ---- (5) localized gallery snapshots (/<lang>/cases/index.html) --- */
  // The switcher navigates to /<lang>/cases; emit those pages so the links
  // resolve. Each is the English gallery with the page language set, the
  // card + switcher links retargeted to that language, and the switcher
  // showing that language as current. Card copy stays English (product and
  // module names are English everywhere); the localized detail pages a card
  // opens are fully translated.
  let localized = 0;
  for (const l of SWITCH_LANGS) {
    if (l.code === 'en') continue;
    let lp = html;
    // Page language (and direction for Arabic).
    lp = lp.replace(/<html lang="[^"]*"/, `<html lang="${l.code}"${l.code === 'ar' ? ' dir="rtl"' : ''}`);
    // Translate the card copy, discipline + role labels, footer and chrome
    // BEFORE the links are retargeted (the card anchors match on /cases/<slug>).
    lp = localizeContent(lp, l.code, content);
    // Retarget every case-card link to the localized detail page.
    lp = lp.replace(/href="\/cases\/([a-z0-9-]+)"/g, `href="/${l.code}/cases/$1"`);
    // Rebuild the switcher for this language (current = l.code).
    lp = lp.replace(
      /<!--oce:lang-switch-->[\s\S]*?<!--\/oce:lang-switch-->/,
      '<!--oce:lang-switch-->' + buildSwitcher(l.code, galleryHref()) + '<!--/oce:lang-switch-->',
    );
    // The active "Cases" nav link points at this language's gallery.
    lp = lp.replace('<a href="/cases" class="is-active"', `<a href="/${l.code}/cases" class="is-active"`);
    // Self-canonical so each localized gallery is indexed on its own URL
    // (it used to canonicalise to the English /cases, which told search
    // engines the localized pages were duplicates and kept them out of the
    // index). hreflang alternates already point every language at each other.
    lp = lp.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="https://openconstructionerp.com/${l.code}/cases"/>`);
    lp = lp.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="https://openconstructionerp.com/${l.code}/cases"/>`);
    // Nav labels (Tour/Compare/Pricing/News/Uberization/Demo/Download) read
    // in this language too, reusing the same tables the detail pages use.
    lp = localizeNavText(lp, l.code);
    const outDir = join(SITE, l.code, 'cases');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), lp);
    localized += 1;
  }

  console.log(`Cards with data-modules: ${carded}`);
  if (missing.length) console.log(`Slugs missing from case-modules.json (${missing.length}): ${missing.join(', ')}`);
  else console.log('All card slugs matched an entry in case-modules.json.');
  console.log(`Localized gallery snapshots written: ${localized} (/<lang>/cases/index.html)`);
  if (content) {
    console.log(`Card copy localized from app locales: ${content.cards.length} cards x ${SNAP_LANGS.length} langs (titles + blurbs + discipline + role labels).`);
    const filled = SNAP_LANGS.filter((l) => GALLERY_CHROME[l.code]).length;
    console.log(`Gallery-only chrome (hero/title/meta/search): ${filled}/${SNAP_LANGS.length} langs filled in GALLERY_CHROME (rest fall back to English).`);
  }
}

/* ---- the runtime honeycomb script (inlined into the page) ----------- */
const HIVE_SCRIPT = `<script>
(function(){
  var overlay=document.getElementById('hiveGrid');
  var board=document.getElementById('grid');
  if(!overlay||!board) return;
  var ICONS={
    'boq':'\\u2630','cost explorer':'\\u20AC','costs':'\\u20AC','finance':'\\u20AC','payroll':'\\u20AC','value':'\\u25C7',
    'assemblies':'\\u274F','labour rates':'\\u20AC','resources':'\\u25A6','resource summary':'\\u25A6','production norms':'\\u2211',
    'validation':'\\u2713','quality':'\\u2713','quality management':'\\u2713','qms':'\\u2713','inspections':'\\u2611','forms':'\\u25A4',
    'reports':'\\u25A4','report':'\\u25A4','portal':'\\u25E7','contracts':'\\u00A7','reconciliation':'\\u21C4','procurement':'\\u26DF',
    'tendering':'\\u2399','bid management':'\\u2696','subcontractors':'\\u26CF','allowances':'\\u25C7','preliminaries':'\\u25A6',
    'schedule':'\\u25F7','advanced schedule':'\\u25F7','progress':'\\u25D4','portfolio':'\\u25A6','capacity planning':'\\u25A4',
    'bim':'\\u25C8','3d model':'\\u25C8','bim viewer':'\\u25C8','federations':'\\u2B21','clash detection':'\\u2737','coordination':'\\u2B21',
    'model issues':'\\u2748','model review':'\\u25C8','carbon':'\\u267B','point cloud':'\\u2059','takeoff':'\\u2736','documents':'\\u25A6',
    'files':'\\u25A6','project files':'\\u25A4','correspondence':'\\u2709','rfis':'?','rfi':'?','markups':'\\u270E','compare':'\\u21C6',
    'safety':'\\u26D1','ncr':'\\u26A0','non-conformances':'\\u26A0','punch list':'\\u2611','close-out':'\\u2691','handover':'\\u2691',
    'assets':'\\u2699','service':'\\u2699','field time':'\\u23F1','daily diary':'\\u270E','site diary':'\\u270E','projects':'\\u25EB',
    'risk register':'\\u26A0','meetings':'\\u2637','tasks':'\\u2611','crm':'\\u260E','contacts':'\\u260E','change orders':'\\u21C4',
    'change intelligence':'\\u2737','equipment':'\\u2699','catalog':'\\u25A6'
  };
  function iconFor(name){
    var k=name.toLowerCase().trim();
    if(ICONS[k]) return ICONS[k];
    for(var key in ICONS){ if(k.indexOf(key)>=0) return ICONS[key]; }
    var m=name.replace(/[^A-Za-z0-9]/g,'');
    return m?m.charAt(0).toUpperCase():'\\u25C6';
  }
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  // Global module vocabulary (the ghost pool), in first-seen order.
  var ALL=[]; (function(){
    var seen={};
    board.querySelectorAll('.card[data-modules]').forEach(function(c){
      (c.getAttribute('data-modules')||'').split('|').forEach(function(m){
        m=m.trim(); if(!m) return; var k=m.toLowerCase();
        if(!seen[k]){ seen[k]=1; ALL.push(m); }
      });
    });
  })();

  // Flat-top hex spiral of axial coords: centre first, then rings out.
  function spiral(radius){
    var out=[{q:0,r:0}];
    var dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    for(var k=1;k<=radius;k++){
      var q=dirs[4][0]*k, r=dirs[4][1]*k;
      for(var s=0;s<6;s++){
        for(var step=0;step<k;step++){ out.push({q:q,r:r}); q+=dirs[s][0]; r+=dirs[s][1]; }
      }
    }
    return out;
  }
  var CELLS=spiral(2); // 19 positions -> a compact cluster beside the card

  // The floating cluster lives inside the fixed overlay (no caption: the
  // card already names the case right beside it).
  var stage=document.createElement('div'); stage.className='hive-stage';
  overlay.appendChild(stage);

  var activeCard=null, lastW=0, lastH=0, raf=0;

  function place(card,cw,ch){
    var rect=card.getBoundingClientRect();
    var vw=window.innerWidth, vh=window.innerHeight, gap=14;
    // Prefer the side with more room: card on the left half -> cluster right.
    var left = (rect.left + rect.width/2 <= vw/2) ? (rect.right + gap) : (rect.left - gap - cw);
    left = Math.max(12, Math.min(left, vw - cw - 12));
    var top = rect.top + rect.height/2 - ch/2;
    top = Math.max(78, Math.min(top, vh - ch - 14)); // 78 keeps clear of the 64px fixed nav
    stage.style.left=left+'px';
    stage.style.top=top+'px';
  }

  function render(card){
    var mods=(card.getAttribute('data-modules')||'').split('|').map(function(s){return s.trim();}).filter(Boolean);
    var n=mods.length;
    if(!n){ hide(); return; }
    var t=card.querySelector('h3'); var title=t?t.textContent.trim():'';
    var bar=card.querySelector('.cbar'); var color=(bar&&bar.style.background)||'var(--accent)';

    // Ghost pool: just 1-2 rings of the platform's OTHER modules around
    // the case's own hexes - enough to say "a few of many", not a field.
    var own={}; mods.forEach(function(m){ own[m.toLowerCase()]=1; });
    var ghosts=ALL.filter(function(m){ return !own[m.toLowerCase()]; });
    var ghostCount=Math.min(ghosts.length, Math.max(0, CELLS.length-n), Math.max(5, 11-n));
    var used=CELLS.slice(0, n+ghostCount);

    var vw=window.innerWidth||1200;
    var w = vw<1100 ? 56 : 64;
    var h=w*0.866, col=w*0.75;
    stage.style.setProperty('--hc-w',w+'px');
    stage.style.setProperty('--hc-h',h+'px');
    stage.style.setProperty('--cap-accent',color);

    // Pixel positions (flat-top): x=col*q, y=h*(r+q/2).
    var pos=used.map(function(c){ return { x:c.q*col, y:h*(c.r + c.q/2) }; });
    var xs=pos.map(function(p){return p.x;}), ys=pos.map(function(p){return p.y;});
    var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs)+w;
    var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys)+h;
    var cw=maxX-minX, ch=maxY-minY;
    stage.style.width=cw+'px';
    stage.style.height=ch+'px';

    var frag=document.createDocumentFragment();
    used.forEach(function(c,i){
      var x=pos[i].x-minX, y=pos[i].y-minY;
      if(i<n){
        var cell=document.createElement('span');
        cell.className='hc-cell';
        cell.style.left=x+'px'; cell.style.top=y+'px';
        cell.style.setProperty('--tint',color);
        cell.style.animationDelay=(i*0.04)+'s';
        cell.title=mods[i];
        cell.innerHTML='<span class="hc-face"><span class="hc-ico" aria-hidden="true">'+iconFor(mods[i])+'</span><span class="hc-title">'+esc(mods[i])+'</span></span>';
        frag.appendChild(cell);
      } else {
        var name=ghosts[i-n];
        var gh=document.createElement('span');
        gh.className='hc-ghost';
        gh.style.left=x+'px'; gh.style.top=y+'px';
        gh.style.setProperty('--tint',color);
        gh.style.animationDelay=(0.10+(i-n)*0.018)+'s';
        gh.title=name;
        gh.innerHTML='<span class="hc-gface"><span class="hc-gico" aria-hidden="true">'+iconFor(name)+'</span></span>';
        frag.appendChild(gh);
      }
    });

    stage.innerHTML='';
    stage.appendChild(frag);

    lastW=cw; lastH=ch;
    stage.classList.remove('no-anim'); // glide when switching cards
    place(card,cw,ch);
    overlay.classList.add('is-on');
  }

  function hide(){ overlay.classList.remove('is-on'); activeCard=null; }
  function activate(card){ if(card && card!==activeCard){ activeCard=card; render(card); } }

  board.addEventListener('mouseover',function(e){ var c=e.target.closest('.card'); if(c) activate(c); });
  board.addEventListener('focusin',function(e){ var c=e.target.closest('.card'); if(c) activate(c); });
  board.addEventListener('mouseleave',hide);

  // Follow the card as the page scrolls (track it tightly, no glide).
  window.addEventListener('scroll',function(){
    if(!activeCard) return;
    if(raf) cancelAnimationFrame(raf);
    raf=requestAnimationFrame(function(){ if(activeCard){ stage.classList.add('no-anim'); place(activeCard,lastW,lastH); } });
  }, {passive:true});
  window.addEventListener('resize',function(){ if(activeCard) render(activeCard); });
})();
</script>`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
