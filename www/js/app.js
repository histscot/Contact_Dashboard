'use strict';
/* Gaspari Transport Contacts — phone-first lookup of Shell carrier contacts.
   Data comes only from the contact-list .xlsx the user uploads; it is kept in this
   device's local storage (nothing is bundled in the app or sent anywhere). */

const NO_TYPE = 'General / Unassigned';
const STORE_KEY = 'cc-data', SUMMARY_KEY = 'cc-last-summary', RECENT_KEY = 'cc-recent';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const store = {
  get(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

/* ---------- highlight rules (same as desktop dashboard) ---------- */
const FLAGS = [
  {key:'safety',  label:'Safety',           re:/\bsafety\b/i},
  {key:'quality', label:'Quality / Claims', re:/\bquality\b(?!\s+(carriers|distribution))|\bclaims?\b/i},
  {key:'checkin', label:'Driver check-in',  re:/\b(?:driver\s+)?check[\s-]?ins?\b/i},
  {key:'plan',    label:'Bulk planning',    re:/\bbulk\s+planning\b|\bplanning\b|\bplanners?\b/i},
];
const FLAG_CLASS = {safety:'red', quality:'red', checkin:'yellow', plan:'purple'};
const flagsOf = x => { const hay = [x.st.join('\n'), x.t, x.n, x.cm].join('\n'); return FLAGS.filter(f => f.re.test(hay)); };
const typeFlag = t => FLAGS.find(f => f.re.test(t));
const typesOf = x => x.st.length ? x.st : [NO_TYPE];
function markText(s){
  let h = esc(s);
  FLAGS.forEach(f => { h = h.replace(new RegExp(f.re.source, 'gi'), m => `<mark class="hl ${FLAG_CLASS[f.key]}">${m}</mark>`); });
  return h;
}

/* ---------- state ---------- */
let DATA = [], META = {}, PAYLOAD = null;
let capFilter = 'All', current = null, detailType = null;

/* ---------- copy + toast ---------- */
let toastTimer;
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copyText(text, msg){
  if(!text){ toast('Nothing to copy'); return; }
  let ok = false;
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Clipboard;
  if(cap){ try{ await cap.write({string: text}); ok = true; }catch(e){} }
  if(!ok && navigator.clipboard && window.isSecureContext){ try{ await navigator.clipboard.writeText(text); ok = true; }catch(e){} }
  if(!ok){
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select();
    try{ ok = document.execCommand('copy'); }catch(e){} ta.remove();
  }
  toast(ok ? (msg || 'Copied') : 'Copy failed — long-press the text to copy');
  if(ok && navigator.vibrate) try{ navigator.vibrate(15); }catch(e){}
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const uniqEmails = contacts => [...new Set(contacts.flatMap(x => x.e.map(e => e.toLowerCase())))];
const mailto = (list, bcc) => bcc ? `mailto:?bcc=${list.join(',')}` : `mailto:${list.join(',')}`;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/gi;

/* ---------- top bar + tabs ---------- */
function setTop(){
  const inDetail = !!current && $('v-lookup').classList.contains('on');
  $('backBtn').hidden = !inDetail;
  $('topTitle').textContent = inDetail ? current.name : 'Gaspari Transport Contacts';
  $('topLogo').hidden = inDetail;
  const n = DATA.reduce((a, c) => a + c.contacts.length, 0);
  $('topSub').textContent = inDetail ? current.scac
    : DATA.length ? `${DATA.length} carriers · ${n} contacts · updated ${fmtDay(META.loadedAt)}` : 'No contact list loaded';
}
const fmtDay = iso => { try{ return new Date(iso).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}); }catch(e){ return ''; } };
function showTab(v){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  window.scrollTo(0, 0);
  setTop();
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  // tapping Lookup while already on it returns to the carrier list
  if(t.dataset.v === 'lookup' && $('v-lookup').classList.contains('on') && current){ history.back(); return; }
  showTab(t.dataset.v);
});

/* =====================================================================
   LOOKUP
   ===================================================================== */
const q = $('q');
function chipGroup(id, cb){
  const el = $(id);
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => { el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
chipGroup('capChips', v => { capFilter = v; renderList(); });
q.addEventListener('input', () => { $('clearQ').hidden = !q.value; renderList(); });
q.addEventListener('keydown', e => {
  if(e.key === 'Enter'){ const first = $('carrierList').querySelector('.c-row'); if(first){ q.blur(); openCarrier(first.dataset.s); } }
});
$('clearQ').onclick = () => { q.value = ''; $('clearQ').hidden = true; renderList(); q.focus(); };

function matches(){
  const s = q.value.trim().toLowerCase();
  let list = DATA.filter(c => capFilter === 'All' || c.caps.includes(capFilter));
  if(s){
    list = list.filter(c => c.scac.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || c.contacts.some(x => (x.loc || '').toLowerCase().includes(s)));
    const rank = c => c.scac.toLowerCase() === s ? 0 : c.scac.toLowerCase().startsWith(s) || c.name.toLowerCase().startsWith(s) ? 1 : 2;
    list.sort((a, b) => rank(a) - rank(b));
  }
  return list;
}
function renderList(){
  const box = $('carrierList');
  if(!DATA.length){
    $('recentWrap').hidden = true; $('listLabel').hidden = true;
    box.innerHTML = `<div class="empty"><h3>No contact list yet</h3><p>Upload the Shell Carrier Contact List (.xlsx) to start looking up carriers.</p><button class="btn big primary" id="emptyUpload">Upload contact list</button></div>`;
    box.style.border = '0'; box.style.background = 'none';
    $('emptyUpload').onclick = () => $('fileIn').click();
    return;
  }
  box.style.border = ''; box.style.background = '';
  const list = matches();
  const recent = (store.get(RECENT_KEY) || []).map(s => DATA.find(c => c.scac === s)).filter(Boolean);
  $('recentWrap').hidden = !!q.value.trim() || !recent.length;
  $('recent').innerHTML = recent.map(c => `<button class="chip recent-chip" data-s="${esc(c.scac)}">${esc(c.name)}</button>`).join('');
  $('recent').querySelectorAll('.chip').forEach(b => b.onclick = () => openCarrier(b.dataset.s));
  $('listLabel').hidden = false;
  $('listLabel').textContent = q.value.trim() ? `${plural(list.length, 'match')}`.replace('matchs', 'matches') : `All carriers (${list.length})`;
  box.innerHTML = list.length ? list.map(c => `
    <button class="c-row" data-s="${esc(c.scac)}">
      <span class="c-scac">${esc(c.scac)}</span>
      <span class="c-main"><span class="c-name">${esc(c.name)}</span><span class="c-meta">${esc(c.caps.join(' · ') || '—')} · ${plural(c.contacts.length, 'contact')}</span></span>
      <span class="c-go">›</span>
    </button>`).join('') : `<div class="empty">No carriers match “${esc(q.value)}”.</div>`;
  box.querySelectorAll('.c-row').forEach(b => b.onclick = () => { q.blur(); openCarrier(b.dataset.s); });
}

function openCarrier(scac, fromHistory){
  const c = DATA.find(x => x.scac === scac);
  if(!c) return;
  current = c; detailType = null;
  const r = (store.get(RECENT_KEY) || []).filter(s => s !== scac); r.unshift(scac); store.set(RECENT_KEY, r.slice(0, 6));
  if(!fromHistory) history.pushState({c: scac}, '', '#c=' + encodeURIComponent(scac));
  showTab('lookup');
  $('lookupList').hidden = true; $('carrierDetail').hidden = false;
  renderDetail();
  window.scrollTo(0, 0);
}
function closeCarrier(){
  current = null;
  $('carrierDetail').hidden = true; $('lookupList').hidden = false;
  renderList(); setTop();
}
$('backBtn').onclick = () => history.back();
window.addEventListener('popstate', e => {
  const s = e.state && e.state.c;
  if(s && DATA.some(c => c.scac === s)) openCarrier(s, true); else closeCarrier();
});

function renderDetail(){
  const c = current, box = $('carrierDetail');
  const shown = detailType ? c.contacts.filter(x => typesOf(x).includes(detailType)) : c.contacts;
  const emails = uniqEmails(shown);
  const allEmails = uniqEmails(c.contacts);
  const cad = [...new Set(c.contacts.map(x => x.cad).filter(Boolean))].join(', ') || '—';
  const lives = c.contacts.map(x => x.live).filter(s => /^\d\d\/\d\d\/\d{4}$/.test(s)).sort((a, b) => new Date(a) - new Date(b));
  const fcount = {}; c.contacts.forEach(x => flagsOf(x).forEach(f => fcount[f.key] = (fcount[f.key] || 0) + 1));
  const untagged = c.contacts.filter(x => !x.st.includes(CHECKIN_TYPE) && flagsOf(x).some(f => f.key === 'checkin')).length;
  const tcount = {}; c.contacts.forEach(x => typesOf(x).forEach(t => tcount[t] = (tcount[t] || 0) + 1));
  const types = Object.keys(tcount).sort((a, b) => (a === NO_TYPE) - (b === NO_TYPE) || (a < b ? -1 : 1));

  box.innerHTML = `
  <div class="d-head">
    <div class="d-id"><div class="d-scac">${esc(c.scac)}</div>
      <div><h2 class="d-name">${esc(c.name)}</h2><div>${c.caps.map(x => `<span class="badge b-${esc(x)}">${esc(x)}</span>`).join('')}</div></div></div>
    <div class="tiles">
      <div class="tile"><div class="tk">Contacts</div><div class="tv">${c.contacts.length}</div></div>
      <div class="tile"><div class="tk">Unique emails</div><div class="tv">${allEmails.length}</div></div>
      <div class="tile"><div class="tk">Meeting cadence</div><div class="tv">${esc(cad)}</div></div>
      <div class="tile"><div class="tk">Date live</div><div class="tv">${lives.length ? esc(lives[0]) : '—'}</div></div>
    </div>
    <div class="legend">${FLAGS.filter(f => fcount[f.key]).map(f => `<span class="flag ${FLAG_CLASS[f.key]}">${esc(f.label)} · ${fcount[f.key]}${f.key === 'checkin' && untagged ? ` (${untagged} not tagged)` : ''}</span>`).join('')}</div>
  </div>
  <div class="action-bar">
    <button class="btn copy-all" id="copyAll" ${emails.length ? '' : 'disabled'}>📋 Copy ${plural(emails.length, 'email')}${detailType ? ' shown' : ''}</button>
    <a class="btn mail-all" id="mailAll" ${emails.length ? `href="${esc(mailto(emails))}"` : 'aria-disabled="true"'}>✉ Email</a>
  </div>
  <div class="chips scroll-x type-filter" id="typeChips">
    <button class="chip ${detailType ? '' : 'on'}" data-t="">All<span class="n">${c.contacts.length}</span></button>
    ${types.map(t => { const f = typeFlag(t); return `<button class="chip ${f ? 't-' + FLAG_CLASS[f.key] : ''} ${detailType === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}<span class="n">${tcount[t]}</span></button>`; }).join('')}
  </div>
  ${detailType ? `<div class="filter-note">Showing ${plural(shown.length, 'contact')} tagged “${esc(detailType)}”. Tap <b>All</b> to see everyone.</div>` : ''}
  <div class="cards">${shown.map(card).join('')}</div>`;

  $('copyAll').onclick = () => copyText(emails.join('; '), `Copied ${plural(emails.length, 'email')} — paste into Outlook`);
  box.querySelectorAll('#typeChips .chip').forEach(b => b.onclick = () => {
    detailType = b.dataset.t || null; const y = window.scrollY; renderDetail(); window.scrollTo(0, y);
  });
  box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText(b.dataset.copy, `Copied ${b.dataset.copy}`));
  // keep the active type chip in view
  const on = box.querySelector('#typeChips .chip.on'); if(on && on.scrollIntoView) on.scrollIntoView({inline: 'center', block: 'nearest'});
  setTop();
}
function card(x){
  const fl = flagsOf(x);
  const cls = fl.length ? ' hl-' + FLAG_CLASS[fl[0].key] : '';
  const flagChips = fl.map(f => (f.key === 'checkin' && !x.st.includes(CHECKIN_TYPE))
    ? `<span class="flag yellow untagged">${esc(f.label)} · not tagged</span>`
    : `<span class="flag ${FLAG_CLASS[f.key]}">${esc(f.label)}</span>`).join('');
  const name = x.n || (x.e.length ? 'Shared mailbox' : 'Unnamed contact');
  const types = x.st.length ? x.st.map(t => { const f = typeFlag(t); return `<span class="tchip ${f ? FLAG_CLASS[f.key] : ''}">${esc(t)}</span>`; }).join('') : `<span class="tchip none">${NO_TYPE}</span>`;
  const phones = x.p ? (x.p.match(PHONE_RE) || []) : [];
  const phoneLines = !x.p ? '' : phones.length
    ? phones.map(ph => `<div class="line"><span class="val plain">${esc(phones.length === 1 ? x.p : ph)}</span><a class="mini" href="tel:${esc(ph.replace(/\s*(ext\.?|x)\s*\d+$/i, '').replace(/[^\d+]/g, ''))}">📞 Call</a></div>`).join('')
    : `<div class="line"><span class="val plain">${esc(x.p)}</span></div>`;
  const meta = [x.cap && `Capability: ${x.cap}`, x.live && `Live: ${x.live}`, x.cad && `Cadence: ${x.cad}`].filter(Boolean).join(' · ');
  return `<div class="card${cls}">
    ${flagChips ? `<div class="flags">${flagChips}</div>` : ''}
    <div class="k-name">${esc(name)}</div>
    ${x.loc ? `<div class="k-loc">${esc(x.loc)}</div>` : ''}
    ${x.t ? `<div class="k-title">${markText(x.t)}</div>` : ''}
    <div class="k-types">${types}</div>
    ${x.e.map(e => `<div class="line"><a class="val" href="mailto:${esc(e)}">${esc(e)}</a><button class="mini copy" data-copy="${esc(e)}">Copy</button></div>`).join('')}
    ${phoneLines}
    ${x.cm ? `<div class="k-note">${markText(x.cm)}</div>` : ''}
    ${meta ? `<div class="k-meta">${esc(meta)}</div>` : ''}
  </div>`;
}

/* =====================================================================
   DISTROS
   ===================================================================== */
let dMode = 'cap', dCap = 'Pack', dTypeCap = 'All';
const dChosen = new Set(['Escalation Contact']);
const dSel = {mode: 'excl', set: new Set()};   // excl = all except set; incl = only set (after Clear)
let dOpen = false;
const isOnD = s => dSel.mode === 'excl' ? !dSel.set.has(s) : dSel.set.has(s);
const resetSel = () => { dSel.mode = 'excl'; dSel.set.clear(); };
document.querySelectorAll('#distroMode button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#distroMode button').forEach(x => x.classList.toggle('on', x === b));
  dMode = b.dataset.v; $('capPanel').hidden = dMode !== 'cap'; $('typePanel').hidden = dMode !== 'type';
  resetSel(); renderDistro();
});
chipGroup('dCap', v => { dCap = v; resetSel(); renderDistro(); });
chipGroup('dTypeCap', v => { dTypeCap = v; renderDistro(); });
$('dIncBoth').onchange = renderDistro;
function capMatch(rowCap, cap, incBoth){
  if(cap === 'All') return true;
  if(cap === 'Both') return rowCap === 'Both';
  return rowCap === cap || (incBoth && rowCap === 'Both');
}
function buildTypeChips(){
  const all = [...new Set(DATA.flatMap(c => c.contacts.flatMap(x => x.st)))].sort().concat([NO_TYPE]);
  [...dChosen].forEach(t => { if(!all.includes(t)) dChosen.delete(t); });
  const cnt = {}; DATA.forEach(c => c.contacts.forEach(x => { if(x.e.length) typesOf(x).forEach(t => cnt[t] = (cnt[t] || 0) + 1); }));
  $('dTypes').innerHTML = all.map(t => { const f = typeFlag(t); return `<button class="chip ${f ? 't-' + FLAG_CLASS[f.key] : ''} ${dChosen.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}<span class="n">${cnt[t] || 0}</span></button>`; }).join('');
  $('dTypes').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    dChosen.has(b.dataset.t) ? dChosen.delete(b.dataset.t) : dChosen.add(b.dataset.t);
    b.classList.toggle('on'); renderDistro();
  });
}
function renderDistro(){
  const out = $('distroOut');
  if(!DATA.length){ out.innerHTML = `<div class="small">Upload the contact list first (Update tab).</div>`; return; }
  const filt = dMode === 'cap'
    ? x => capMatch(x.cap, dCap, $('dIncBoth').checked)
    : x => typesOf(x).some(t => dChosen.has(t)) && capMatch(x.cap, dTypeCap, true);
  $('dIncBoth').disabled = dCap === 'All' || dCap === 'Both';
  const groups = DATA.map(c => ({c, em: uniqEmails(c.contacts.filter(filt))})).filter(g => g.em.length);
  const draw = () => {
    const on = groups.filter(g => isOnD(g.c.scac));
    const em = [...new Set(on.flatMap(g => g.em))];
    out.querySelector('.count').innerHTML = `<b>${em.length}</b> email${em.length === 1 ? "" : "s"} · <b>${on.length}</b> of ${groups.length} carriers`;
    const cb = out.querySelector('#dCopy'); cb.disabled = !em.length; cb.textContent = `📋 Copy ${plural(em.length, 'email')}`;
    cb.onclick = () => copyText(em.join('; '), `Copied ${plural(em.length, 'email')} — paste into Outlook (BCC)`);
    const mb = out.querySelector('#dMail'); if(em.length) mb.setAttribute('href', mailto(em, true)); else mb.removeAttribute('href');
    out.querySelector('textarea').value = em.join('; ');
  };
  out.innerHTML = `
    <div class="count"></div>
    <div class="btns"><button class="btn copy-all" id="dCopy"></button><a class="btn mail-all" id="dMail">✉ BCC</a></div>
    <details id="dList" ${dOpen ? 'open' : ''}><summary>Choose carriers</summary>
      <div class="cl-tools"><button class="btn ghost" data-act="all">All</button><button class="btn ghost" data-act="none">Clear</button><input type="search" id="dFind" placeholder="Find carrier"></div>
      ${groups.map(g => `<label class="cl-row" data-k="${esc((g.c.scac + ' ' + g.c.name).toLowerCase())}"><input type="checkbox" data-s="${esc(g.c.scac)}" ${isOnD(g.c.scac) ? 'checked' : ''}><span class="nm"><b>${esc(g.c.scac)}</b> ${esc(g.c.name)}</span><span class="n">${g.em.length}</span></label>`).join('')}
    </details>
    <details><summary>Show addresses</summary><textarea readonly></textarea></details>`;
  out.querySelector('#dList').ontoggle = e => { dOpen = e.target.open; };
  const boxes = [...out.querySelectorAll('.cl-row input')];
  boxes.forEach(i => i.onchange = () => { (i.checked === (dSel.mode === 'excl')) ? dSel.set.delete(i.dataset.s) : dSel.set.add(i.dataset.s); draw(); });
  out.querySelector('[data-act=all]').onclick = () => { resetSel(); boxes.forEach(i => i.checked = true); draw(); };
  out.querySelector('[data-act=none]').onclick = () => { dSel.mode = 'incl'; dSel.set.clear(); boxes.forEach(i => i.checked = false); draw(); };
  out.querySelector('#dFind').oninput = e => { const s = e.target.value.trim().toLowerCase(); out.querySelectorAll('.cl-row').forEach(l => l.hidden = !!s && !l.dataset.k.includes(s)); };
  draw();
}

/* =====================================================================
   UPDATE (upload .xlsx)
   ===================================================================== */
function renderUpdateInfo(){
  $('dataInfo').innerHTML = DATA.length
    ? `<b>${esc(META.source || 'Contact list')}</b><br>${DATA.length} carriers · ${DATA.reduce((a, c) => a + c.contacts.length, 0)} contacts<br><span class="muted">Loaded ${esc(new Date(META.loadedAt).toLocaleString())}</span>`
    : `<span class="muted">No contact list loaded yet.</span>`;
  const ex = (PAYLOAD && PAYLOAD.excluded) || [];
  $('excludedPanel').hidden = !ex.length;
  $('excludedList').textContent = ex.join(', ');
  const s = store.get(SUMMARY_KEY);
  $('updateSummary').innerHTML = s ? s.html : '';
}
function delta(n, o){
  if(o === undefined || o === null) return '';
  const d = n - o;
  return `<div class="d ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d} vs previous (${o})</div>`;
}
function summaryHtml(prev, next){
  const ps = (prev.meta && prev.meta.stats) || null, ns = next.meta.stats;
  const pc = prev.carriers || [], nc = next.carriers;
  const cnt = cs => cs.reduce((a, c) => a + c.contacts.length, 0);
  const pSet = new Set(pc.map(c => c.scac)), nSet = new Set(nc.map(c => c.scac));
  const pEx = new Set((prev.meta && prev.meta.excludedFull) || []), nEx = new Set(next.meta.excludedFull);
  const nm = s => (next.meta.names && next.meta.names[s]) || (prev.meta && prev.meta.names && prev.meta.names[s]) || '';
  const lab = s => `${esc(s)} ${esc(nm(s))}`;
  const notes = [];
  if(pc.length){
    const nx = [...nEx].filter(s => !pEx.has(s)), back = [...pEx].filter(s => !nEx.has(s) && nSet.has(s));
    const add = [...nSet].filter(s => !pSet.has(s) && !pEx.has(s)), gone = [...pSet].filter(s => !nSet.has(s) && !nEx.has(s));
    if(nx.length) notes.push(`Now crossed out: ${nx.map(lab).join(', ')}`);
    if(back.length) notes.push(`No longer crossed out: ${back.map(lab).join(', ')}`);
    if(add.length) notes.push(`New carriers: ${add.map(lab).join(', ')}`);
    if(gone.length) notes.push(`No longer in the file: ${gone.map(lab).join(', ')}`);
  }
  const pct = ns.rows ? Math.round(ns.typeFilled / ns.rows * 100) : 0;
  return `<div class="panel notice"><h2 class="h2">✓ Updated from ${esc(next.meta.source)}</h2>
    <div class="sumgrid">
      <div class="sum"><div class="tk">Service Type filled</div><div class="v">${ns.typeFilled}<small class="muted" style="font-size:13px"> / ${ns.rows} (${pct}%)</small></div>${ps ? delta(ns.typeFilled, ps.typeFilled) : ''}</div>
      <div class="sum"><div class="tk">Carriers</div><div class="v">${nc.length}</div>${pc.length ? delta(nc.length, pc.length) : ''}</div>
      <div class="sum"><div class="tk">Contacts</div><div class="v">${cnt(nc)}</div>${pc.length ? delta(cnt(nc), cnt(pc)) : ''}</div>
    </div>
    ${notes.length ? `<ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : pc.length ? '<div class="small">No carriers added, removed or newly crossed out.</div>' : ''}
  </div>`;
}
async function handleFile(f){
  if(!f) return;
  if(!/\.xlsx$/i.test(f.name)){ showError(`Please choose an Excel .xlsx file (got “${f.name}”).`); return; }
  toast('Reading contact list…');
  try{
    const rows = await readXlsx(await f.arrayBuffer());
    const payload = buildPayload(rows, f.name);
    const prev = PAYLOAD || {};
    const html = summaryHtml(prev, payload);
    if(!store.set(STORE_KEY, payload)) throw new Error('Could not save the contact list on this device (storage full?).');
    store.set(SUMMARY_KEY, {html});
    applyData(payload);
    showTab('update');
    toast(`Loaded ${plural(payload.carriers.length, 'carrier')}`);
  }catch(err){
    console.error(err); showError(err.message || String(err));
  }
}
function showError(msg){
  $('updateSummary').innerHTML = `<div class="panel notice err"><h2 class="h2">Couldn't read that file</h2><div class="small">${esc(msg)}</div></div>`;
  showTab('update');
}
$('fileIn').onchange = () => { const f = $('fileIn').files[0]; $('fileIn').value = ''; handleFile(f); };
let clearArmed = null;
$('clearData').onclick = () => {
  const b = $('clearData');
  if(!clearArmed){ b.textContent = 'Tap again to remove'; clearArmed = setTimeout(() => { clearArmed = null; b.textContent = 'Remove contact data'; }, 4000); return; }
  clearTimeout(clearArmed); clearArmed = null; b.textContent = 'Remove contact data';
  store.del(STORE_KEY); store.del(SUMMARY_KEY); store.del(RECENT_KEY);
  applyData(null); toast('Contact data removed');
};

/* ---------- apply ---------- */
function applyData(payload){
  PAYLOAD = payload; DATA = payload ? payload.carriers : []; META = payload ? payload.meta : {};
  if(current){ const again = DATA.find(c => c.scac === current.scac); current = again || null; }
  if(!current){ $('carrierDetail').hidden = true; $('lookupList').hidden = false; }
  resetSel(); buildTypeChips(); renderList(); renderDistro(); renderUpdateInfo();
  if(current) renderDetail();
  setTop();
}

/* ---------- init ---------- */
applyData(store.get(STORE_KEY));
history.replaceState({}, '', location.pathname + location.search);
