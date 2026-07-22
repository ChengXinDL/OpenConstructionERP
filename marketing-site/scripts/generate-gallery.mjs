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

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '..');
const GALLERY = join(SITE, 'cases', 'index.html');
const DETAIL = join(SITE, 'cases', 'answer-an-rfi.html');
const MODULES_JSON = join(here, 'case-modules.json');
const HIVE_CSS = join(here, 'cases-hive.css');

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

/* ==================================================================== */
function main() {
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

  /* ---- (4) hover script + nav wiring before </body> --------------- */
  const jsBlock = '<!--oce:gallery-js-->' + HIVE_SCRIPT + navJs + '<!--/oce:gallery-js-->';
  html = html.replace(
    /<!--oce:gallery-js-->[\s\S]*?<!--\/oce:gallery-js-->\s*<\/body>|<\/body>/,
    jsBlock + '</body>',
  );

  writeFileSync(GALLERY, html);

  console.log(`Cards with data-modules: ${carded}`);
  if (missing.length) console.log(`Slugs missing from case-modules.json (${missing.length}): ${missing.join(', ')}`);
  else console.log('All card slugs matched an entry in case-modules.json.');
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

  // The floating cluster + its caption live inside the fixed overlay.
  var stage=document.createElement('div'); stage.className='hive-stage';
  var cap=document.createElement('div'); cap.className='hive-cap';
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

    // Ghost pool: the platform's OTHER modules (exclude this case's).
    var own={}; mods.forEach(function(m){ own[m.toLowerCase()]=1; });
    var ghosts=ALL.filter(function(m){ return !own[m.toLowerCase()]; });
    var ghostCount=Math.min(ghosts.length, Math.max(0, CELLS.length-n));
    var used=CELLS.slice(0, n+ghostCount);

    var vw=window.innerWidth||1200;
    var w = vw<1100 ? 40 : 46;
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

    cap.innerHTML='<span class="dot"></span><b>'+esc(title)+'</b> \\u00b7 '+n+' of '+ALL.length+' modules';
    stage.innerHTML='';
    stage.appendChild(cap);
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

main();
