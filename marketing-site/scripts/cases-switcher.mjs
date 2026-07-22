/*
 * cases-switcher.mjs  (shared helper)
 *
 * A URL-based language switcher for the STATIC case pages. Unlike the
 * homepage picker (i18n.js) which swaps strings by fetching a JSON locale,
 * every case page is its own per-language URL, so here selecting a language
 * simply navigates to the same page in that language.
 *
 *   English : /cases/<slug>            and  /cases            (gallery)
 *   Other   : /<lang>/cases/<slug>     and  /<lang>/cases     (gallery)
 *
 * The visible design matches the homepage picker: a flag + code button that
 * opens a menu of flag + code + native name. Both generators import this so
 * the two surfaces stay identical; each passes an hrefFor(code) that knows
 * how to build the localized URL for its own page.
 *
 * The 19 languages below are exactly the set the homepage offers and the set
 * that has localized case pages. The switcher CSS lives in cases-hive.css
 * (shared @hive-core block) and the toggle script rides along in the shared
 * nav wiring, so this module only produces the button + menu markup.
 */

// Homepage order; flag = flagcdn country code; name = native label.
export const SWITCH_LANGS = [
  { code: 'en', flag: 'gb', name: 'English' },
  { code: 'de', flag: 'de', name: 'Deutsch' },
  { code: 'fr', flag: 'fr', name: 'Français' },
  { code: 'es', flag: 'es', name: 'Español' },
  { code: 'it', flag: 'it', name: 'Italiano' },
  { code: 'pt', flag: 'pt', name: 'Português' },
  { code: 'nl', flag: 'nl', name: 'Nederlands' },
  { code: 'pl', flag: 'pl', name: 'Polski' },
  { code: 'cs', flag: 'cz', name: 'Čeština' },
  { code: 'ru', flag: 'ru', name: 'Русский' },
  { code: 'bg', flag: 'bg', name: 'Български' },
  { code: 'tr', flag: 'tr', name: 'Türkçe' },
  { code: 'sv', flag: 'se', name: 'Svenska' },
  { code: 'no', flag: 'no', name: 'Norsk' },
  { code: 'fi', flag: 'fi', name: 'Suomi' },
  { code: 'da', flag: 'dk', name: 'Dansk' },
  { code: 'ar', flag: 'sa', name: 'العربية' },
  { code: 'zh', flag: 'cn', name: '中文' },
  { code: 'ja', flag: 'jp', name: '日本語' },
  { code: 'ko', flag: 'kr', name: '한국어' },
];

const byCode = Object.fromEntries(SWITCH_LANGS.map((l) => [l.code, l]));
const flagSrc = (flag) => `https://flagcdn.com/${flag}.svg`;

/**
 * Build the switcher markup (button + menu) for one page.
 * @param {string} currentCode  the page's own language code.
 * @param {(code:string)=>string} hrefFor  localized URL for a given language.
 * @returns {string} HTML for a single <div class="oce-lang"> block.
 */
export function buildSwitcher(currentCode, hrefFor) {
  const cur = byCode[currentCode] || byCode.en;
  const items = SWITCH_LANGS.map((l) => {
    const active = l.code === currentCode ? ' is-current' : '';
    const aria = l.code === currentCode ? ' aria-current="true"' : '';
    return (
      `<a role="menuitem" class="oce-lang-item${active}"${aria} href="${hrefFor(l.code)}" hreflang="${l.code}">` +
      `<img src="${flagSrc(l.flag)}" width="20" height="15" alt="" loading="lazy" decoding="async"/>` +
      `<span class="oce-lang-mc">${l.code.toUpperCase()}</span>` +
      `<span class="oce-lang-mn">${l.name}</span></a>`
    );
  }).join('');
  return (
    '<div class="oce-lang" data-oce-lang>' +
    '<button type="button" class="oce-lang-btn" aria-haspopup="true" aria-expanded="false" ' +
    'aria-label="Change language" title="Change language">' +
    `<img class="oce-lang-flag" src="${flagSrc(cur.flag)}" width="20" height="15" alt="" loading="eager" decoding="async"/>` +
    `<span class="oce-lang-code">${cur.code.toUpperCase()}</span>` +
    '<svg class="oce-lang-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</button>' +
    '<div class="oce-lang-menu" role="menu" aria-label="Language" hidden>' + items + '</div>' +
    '</div>'
  );
}

// The toggle script, injected once per page (rides along in the shared nav
// wiring). Opens/closes the menu, closes on outside click or Escape.
export const SWITCHER_JS =
  "(function(){var wrap=document.querySelector('[data-oce-lang]');if(!wrap)return;" +
  "var btn=wrap.querySelector('.oce-lang-btn'),menu=wrap.querySelector('.oce-lang-menu');" +
  "if(!btn||!menu)return;function open(o){menu.hidden=!o;btn.setAttribute('aria-expanded',o?'true':'false');}" +
  "btn.addEventListener('click',function(e){e.stopPropagation();open(menu.hidden);});" +
  "document.addEventListener('click',function(e){if(!wrap.contains(e.target))open(false);});" +
  "document.addEventListener('keydown',function(e){if(e.key==='Escape')open(false);});})();";

// hrefFor builders for the two surfaces.
export const detailHref = (slug) => (code) =>
  code === 'en' ? `/cases/${slug}` : `/${code}/cases/${slug}`;
export const galleryHref = () => (code) => (code === 'en' ? '/cases' : `/${code}/cases`);
