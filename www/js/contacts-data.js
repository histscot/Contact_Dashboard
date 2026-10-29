// Excel (.xlsx) reader + contact-list build rules. Shared with the desktop dashboard.
// Reads the Shell Carrier Contact List, drops crossed-out rows, groups contacts by SCAC.
/* =====================================================================
   XLSX READER (no libraries) — unzip + read shared strings, styles, sheet
   ===================================================================== */
async function unzip(buf){
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for(let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--){
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error("This doesn't look like an .xlsx file (it may be an old .xls or a CSV). Save it as .xlsx and try again.");
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const td = new TextDecoder();
  for(let k = 0; k < n; k++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = {method, csize, loff};
    p += 46 + nlen + elen + clen;
  }
  return async function read(name){
    const f = files[name] || files[name.replace(/^\//,'')];
    if(!f) return null;
    const lnl = dv.getUint16(f.loff + 26, true), lel = dv.getUint16(f.loff + 28, true);
    const start = f.loff + 30 + lnl + lel;
    const data = u8.subarray(start, start + f.csize);
    if(f.method === 0) return td.decode(data);
    if(f.method !== 8) throw new Error('Unsupported compression in the .xlsx file.');
    if(typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to read .xlsx files. Please use a current Chrome or Edge.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return td.decode(await new Response(stream).arrayBuffer());
  };
}
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, tag) => [...el.children].filter(c => c.localName === tag);
const all = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
const unx = s => s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const isOn = el => { if(!el) return false; const v = el.getAttribute('val'); return v === null || !/^(0|false)$/i.test(v); };

function richText(si){
  const runs = kids(si, 'r');
  if(!runs.length){ return {text: unx(kids(si, 't').map(t => t.textContent).join('')), struck: false}; }
  let text = '', anyText = false, allStruck = true;
  runs.forEach(r => {
    const t = unx(kids(r, 't').map(x => x.textContent).join(''));
    text += t;
    if(t.trim()){
      anyText = true;
      const rpr = kids(r, 'rPr')[0];
      if(!(rpr && isOn(kids(rpr, 'strike')[0]))) allStruck = false;
    }
  });
  return {text, struck: anyText && allStruck};
}
const colIdx = ref => { let n = 0; for(const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function serialToDate(v){
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(parseFloat(v) * 86400000));
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

async function readXlsx(buf){
  const read = await unzip(buf);
  const wbXml = await read('xl/workbook.xml');
  if(!wbXml) throw new Error("Couldn't find a worksheet in this file. Is it an Excel .xlsx?");
  const wb = xml(wbXml);
  const sheet = all(wb, 'sheet')[0];
  const rid = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
  let target = 'worksheets/sheet1.xml';
  const rels = await read('xl/_rels/workbook.xml.rels');
  if(rels){ const rel = all(xml(rels), 'Relationship').find(r => r.getAttribute('Id') === rid); if(rel) target = rel.getAttribute('Target'); }
  const sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');

  const ssXml = await read('xl/sharedStrings.xml');
  const SS = ssXml ? all(xml(ssXml), 'si').map(richText) : [];

  const stXml = await read('xl/styles.xml');
  let fontStrike = [], xfFont = [];
  if(stXml){
    const st = xml(stXml);
    const fonts = all(st, 'fonts')[0];
    if(fonts) fontStrike = kids(fonts, 'font').map(f => isOn(kids(f, 'strike')[0]));
    const xfs = all(st, 'cellXfs')[0];
    if(xfs) xfFont = kids(xfs, 'xf').map(x => +(x.getAttribute('fontId') || 0));
  }
  const sh = xml(await read(sheetPath));
  const rows = [];
  all(sh, 'row').forEach(row => {
    const cells = [];
    let next = 0;
    kids(row, 'c').forEach(c => {
      const r = c.getAttribute('r'); const ci = r ? colIdx(r) : next; next = ci + 1;
      const t = c.getAttribute('t'), s = +(c.getAttribute('s') || 0);
      let text = '', has = false, rich = false, num = false;
      const v = kids(c, 'v')[0];
      if(t === 's'){ if(v){ const o = SS[+v.textContent] || {text: '', struck: false}; text = o.text; rich = o.struck; has = true; } }
      else if(t === 'inlineStr'){ const is = kids(c, 'is')[0]; if(is){ const o = richText(is); text = o.text; rich = o.struck; has = true; } }
      else if(v){
        text = t === 'str' || t === 'e' ? unx(v.textContent) : v.textContent; has = true; num = !t || t === 'n';
        if(num){ const x = Number(text); if(Number.isFinite(x)) text = Number.isInteger(x) ? BigInt(Math.round(x)).toString() : String(x); }
      }
      cells[ci] = {text, has, num, struck: !!fontStrike[xfFont[s]] || rich};
    });
    rows.push(cells);
  });
  return rows;
}

/* =====================================================================
   BUILD — same rules as before: drop crossed-out rows, group by SCAC
   ===================================================================== */
const COLS = ["Carrier SCAC","Carrier Name","Service Capability","Service Type","Carrier Title/Description",
              "Date Live","Contact Name","Contact Email","Contact Phone","Carrier Meeting Cadence","Comment Box"];
const NORM = {"Operations Contact (incl dispatch)": "Operations / Terminal / Regional (incl dispatch)",
              "Primary Operations Contact (incl dispatch)": "Operations / Terminal / Regional (incl dispatch)"};
const CHECKIN_TYPE = 'Driver Check-in';
const canonType = t => NORM[t] || (/^driver\s*check[\s-]*ins?$/i.test(t) ? CHECKIN_TYPE : t);
const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const lc = s => s.toLowerCase();
const byStr = f => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

function buildPayload(sheetRows, fileName){
  const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const hi = sheetRows.findIndex(r => r && r.some(c => c && norm(c.text) === 'carrier scac'));
  if(hi < 0) throw new Error('Couldn\'t find the "Carrier SCAC" header. Is this the Shell Carrier Contact List?');
  const hdr = sheetRows[hi].map(c => c ? norm(c.text) : '');
  const idx = COLS.map(name => hdr.indexOf(norm(name)));
  const missing = COLS.filter((n, i) => idx[i] < 0 && ["Carrier SCAC","Carrier Name","Service Capability","Service Type","Contact Email"].includes(n));
  if(missing.length) throw new Error('These columns are missing from the file: ' + missing.join(', '));

  const stats = {rows: 0, typeFilled: 0, activeRows: 0, typeFilledActive: 0};
  const rows = [], struck = {}, total = {}, names = {};
  for(let r = hi + 1; r < sheetRows.length; r++){
    const raw = sheetRows[r] || [];
    const cell = i => (idx[i] >= 0 ? raw[idx[i]] : null);
    const val = i => { const c = cell(i); return c ? String(c.text).trim() : ''; };
    if(COLS.every((_, i) => !val(i))) continue;
    stats.rows++;
    const scac = val(0), nm = val(1);
    if(val(3)) stats.typeFilled++;
    total[scac] = (total[scac] || 0) + 1;
    if(scac && nm && !(scac in names)) names[scac] = nm;
    const isStruck = [0,1,2,3,4,5,6,7,8].some(i => { const c = cell(i); return c && c.has && c.struck; });
    if(isStruck){ struck[scac] = (struck[scac] || 0) + 1; continue; }
    stats.activeRows++;
    if(val(3)) stats.typeFilledActive++;
    const lv = cell(5);
    const live = lv && lv.num && /^\d+(\.\d+)?$/.test(lv.text.trim()) ? serialToDate(lv.text) : val(5);
    const emailRaw = val(7);
    const emails = [...new Set((emailRaw.match(EMAIL_RE) || []).map(e => e.replace(/\.+$/, '')))];
    let phone = val(8);
    const extra = emailRaw.replace(EMAIL_RE, '').replace(/^[\s;,/]+|[\s;,/]+$/g, '');
    if(extra && !phone) phone = extra;
    const types = [...new Set(val(3).split('\n').map(t => t.trim()).filter(Boolean).map(canonType))];
    rows.push({scac, name: nm, cap: val(2), types, title: val(4), live, contact: val(6), emails, phone, cadence: val(9), comment: val(10)});
  }
  const by = new Map();
  rows.forEach(o => { if(!by.has(o.scac)) by.set(o.scac, []); by.get(o.scac).push(o); });
  const carriers = [];
  by.forEach((cs, scac) => {
    const cnt = new Map();
    cs.forEach(c => { if(c.name) cnt.set(c.name, (cnt.get(c.name) || 0) + 1); });
    let base = scac, best = 0, short = null;
    cnt.forEach((n, k) => { if(n > best){ best = n; base = k; } if(short === null || k.length < short.length) short = k; });
    if(short !== null && base.startsWith(short)) base = short;
    const contacts = cs.map(c => ({n: c.contact, t: c.title, st: c.types, e: c.emails, p: c.phone, cap: c.cap,
      loc: ((c.name || base) === base ? '' : c.name), live: c.live, cad: c.cadence, cm: c.comment}));
    carriers.push({scac, name: base, caps: [...new Set(cs.map(c => c.cap).filter(Boolean))].sort(), contacts});
  });
  carriers.sort(byStr(c => lc(c.name)));
  const full = Object.keys(struck).filter(k => struck[k] === total[k]).sort(byStr(k => lc(names[k] || k)));
  const partial = Object.keys(struck).filter(k => struck[k] < total[k]).sort();
  const excluded = full.map(k => `${k} ${names[k] || ''}`.trim())
    .concat(partial.map(k => `plus ${struck[k]} crossed-out contact${struck[k] > 1 ? 's' : ''} at ${k} ${names[k] || ''}`.trim()));
  if(!carriers.length) throw new Error('No carrier rows were found under the header row.');
  return {carriers, excluded,
          meta: {source: fileName, loadedAt: new Date().toISOString(), stats, excludedFull: full, names}};
}

