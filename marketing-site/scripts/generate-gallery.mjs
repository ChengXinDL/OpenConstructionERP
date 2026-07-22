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
 *   2. Honeycomb-on-hover. The card grid runs full width (no side panel).
 *      A single centred, transparent honeycomb "field" sits above it.
 *      Hovering or focusing a card lights that case's modules as solid
 *      flip-hexes in the centre of the field, ringed by the platform's
 *      OTHER modules as faint ghost hexes - so the selection reads as a
 *      few picks out of many available modules. Per-case module lists
 *      come from scripts/case-modules.json; each card carries a
 *      data-modules="A|B|C" attribute the runtime reads. The global
 *      module vocabulary (the ghost pool) is derived from every card at
 *      runtime. The field rests on the first case so it is never empty.
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

  /* ---- (3b) insert the transparent honeycomb hero above the grid --- */
  const heroHtml =
    '<section class="cases-hive" aria-label="Modules used by this playbook">' +
    '<div class="hive-head">' +
    '<span class="hive-eyebrow">Modules in play</span>' +
    '<h2 class="hive-title" id="hiveTitle">One platform, shaped to how you build</h2>' +
    '<span class="hive-count" id="hiveCount">Hover a playbook to light up its modules</span>' +
    '</div>' +
    '<div class="hive-grid" id="hiveGrid" aria-live="polite"></div>' +
    '</section>';

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
    '<main class="wrap"><!--oce:gallery-hive-->' + heroHtml +
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
  var grid=document.getElementById('hiveGrid');
  var titleEl=document.getElementById('hiveTitle');
  var countEl=document.getElementById('hiveCount');
  var board=document.getElementById('grid');
  if(!grid||!board) return;
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
  var CELLS=spiral(3); // 37 positions -> a lush field

  function render(mods,title,color){
    grid.innerHTML='';
    var n=mods.length;
    if(!n){ if(countEl) countEl.textContent=''; return; }

    // Ghost pool: the platform's OTHER modules (exclude this case's).
    var own={}; mods.forEach(function(m){ own[m.toLowerCase()]=1; });
    var ghosts=ALL.filter(function(m){ return !own[m.toLowerCase()]; });
    var ghostCount=Math.min(ghosts.length, Math.max(0, CELLS.length-n));
    var used=CELLS.slice(0, n+ghostCount);

    var vw=Math.min(window.innerWidth||960, 980);
    var w = vw<900 ? 50 : 58;
    var h=w*0.866, col=w*0.75;
    grid.style.setProperty('--hc-w',w+'px');
    grid.style.setProperty('--hc-h',h+'px');

    // Pixel positions (flat-top): x=col*q, y=h*(r+q/2).
    var pos=used.map(function(c){ return { x:c.q*col, y:h*(c.r + c.q/2) }; });
    var xs=pos.map(function(p){return p.x;}), ys=pos.map(function(p){return p.y;});
    var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs)+w;
    var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys)+h;
    grid.style.width=(maxX-minX)+'px';
    grid.style.height=(maxY-minY)+'px';

    var pal=[color||'var(--accent)','var(--accent)','var(--accent-3)','var(--accent-2)'];
    var gpal=['var(--accent)','var(--accent-3)','var(--accent-2)'];

    used.forEach(function(c,i){
      var x=pos[i].x-minX, y=pos[i].y-minY;
      if(i<n){
        var cell=document.createElement('span');
        cell.className='hc-cell';
        cell.style.left=x+'px'; cell.style.top=y+'px';
        cell.style.setProperty('--tint',pal[i%pal.length]);
        cell.style.animationDelay=(i*0.045)+'s';
        cell.title=mods[i];
        cell.innerHTML='<span class="hc-face hc-face-front"><span class="hc-ico" aria-hidden="true">'+iconFor(mods[i])+'</span><span class="hc-title">'+esc(mods[i])+'</span></span><span class="hc-face hc-face-back"><span class="hc-title">'+esc(mods[i])+'</span><span class="hc-sub">module</span></span>';
        grid.appendChild(cell);
      } else {
        var name=ghosts[i-n];
        var gh=document.createElement('span');
        gh.className='hc-ghost';
        gh.style.left=x+'px'; gh.style.top=y+'px';
        gh.style.setProperty('--tint',gpal[i%gpal.length]);
        gh.style.animationDelay=(0.12+(i-n)*0.02)+'s';
        gh.title=name;
        gh.innerHTML='<span class="hc-gface"><span class="hc-gico" aria-hidden="true">'+iconFor(name)+'</span></span>';
        grid.appendChild(gh);
      }
    });

    if(titleEl) titleEl.textContent=title;
    if(countEl) countEl.textContent=n+(n===1?' module':' modules')+' in this playbook of '+ALL.length+' available';
  }
  function fromCard(card){
    if(!card) return;
    var mods=(card.getAttribute('data-modules')||'').split('|').filter(Boolean);
    var t=card.querySelector('h3'); var title=t?t.textContent:'';
    var bar=card.querySelector('.cbar'); var color=bar?bar.style.background:'var(--accent)';
    render(mods,title,color);
  }
  var active=null;
  function activate(card){ if(card && card!==active){ active=card; fromCard(card); } }
  board.addEventListener('mouseover',function(e){ var c=e.target.closest('.card'); if(c) activate(c); });
  board.addEventListener('focusin',function(e){ var c=e.target.closest('.card'); if(c) activate(c); });
  var first=board.querySelector('.card');
  if(first){ active=first; fromCard(first); }
  var rt;
  window.addEventListener('resize',function(){ clearTimeout(rt); rt=setTimeout(function(){ if(active) fromCard(active); },150); });
})();
</script>`;

main();
