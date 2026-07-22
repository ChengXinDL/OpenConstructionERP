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
import { CHROME } from './cases-chrome.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MARKETING_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(MARKETING_ROOT, '..');

const DEFAULT_BASE = 'https://openconstructionerp.com';

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

  // Always start from a clean template (strip any previously injected block).
  let html = rawEnglish.replace(/<!--oce:cases-seo-->[\s\S]*?<!--\/oce:cases-seo-->/, '');
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
      // Top-nav labels with no nav.* key (from the chrome table).
      html = html.split('<a href="/#tour">Tour</a>').join(`<a href="/#tour">${R(ch.navTour)}</a>`);
      html = html.split('<a href="/#compare">Compare</a>').join(`<a href="/#compare">${R(ch.navCompare)}</a>`);
      html = html.split('<a href="/#pricing">Pricing</a>').join(`<a href="/#pricing">${R(ch.navPricing)}</a>`);
      html = html.split('<a href="/news">News</a>').join(`<a href="/news">${R(ch.navNews)}</a>`);
      html = html
        .split('<a href="/uberization-of-construction/">Uberization</a>')
        .join(`<a href="/uberization-of-construction/">${R(ch.navUberization)}</a>`);
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

  // Inject the SEO head cluster just before </head>, for every language.
  html = html.replace('</head>', `${seoBlock(base, slug, lang, T, pb)}</head>`);

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
