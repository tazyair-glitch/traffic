import { analyzeImage, verdict, LEVELS } from './analyzer.js';

const $ = id => document.getElementById(id);
const KEY = 'tlm.locations.v1';

// ---------- storage ----------
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { alert('שמירה נכשלה: ' + e.message); } }
let locations = load();
let currentLoc = null;   // location object or null (quick analysis)
let editingId = null;
let currentImg = null;   // last image analyzed
let roi = null;          // {x,y,w,h} fractions

// ---------- navigation ----------
function show(view, title) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + view));
  $('title').textContent = title || 'עומסי תנועה';
  $('backBtn').classList.toggle('hidden', view === 'list');
  $('addBtn').classList.toggle('hidden', view !== 'list');
  if (view !== 'detail') $('wazeFrame').src = 'about:blank';
  window.scrollTo(0, 0);
}
$('backBtn').onclick = () => { renderList(); show('list'); };

// ---------- list ----------
function renderList() {
  const el = $('locList');
  if (!locations.length) { el.innerHTML = '<div class="empty">אין עדיין מיקומים.<br>לחץ "+ מיקום" כדי להוסיף.</div>'; return; }
  el.innerHTML = '';
  for (const L of locations) {
    const last = L.history?.[0];
    const v = last ? verdict(last, L) : null;
    const d = document.createElement('div');
    d.className = 'card loc';
    d.innerHTML = `<span class="dot" style="background:${v ? v.color : ''}"></span>
      <div style="flex:1"><div class="name"></div>
      <div class="sub">${last ? `${v.text} · מדד ${last.index.toFixed(0)} · ${fmtTime(last.t)}` : 'טרם נבדק'}</div></div><span>‹</span>`;
    d.querySelector('.name').textContent = L.name;
    d.onclick = () => openDetail(L);
    el.appendChild(d);
  }
}
const fmtTime = t => new Date(t).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

// ---------- add / edit ----------
$('addBtn').onclick = () => openEdit(null);
$('editLoc').onclick = () => openEdit(currentLoc);

function openEdit(L) {
  editingId = L?.id || null;
  $('f-name').value = L?.name || '';
  $('f-link').value = '';
  $('f-lat').value = L?.lat ?? '';
  $('f-lon').value = L?.lon ?? '';
  $('f-zoom').value = L?.zoom ?? 15;
  $('f-low').value = L?.low ?? 8;
  $('f-high').value = L?.high ?? 25;
  $('delLoc').classList.toggle('hidden', !L);
  show('edit', L ? 'עריכת מיקום' : 'מיקום חדש');
}

// Extract lat/lon (and zoom) from a pasted Waze / Google Maps link
$('f-link').addEventListener('input', e => {
  const s = decodeURIComponent(e.target.value);
  const m = s.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) ||
            s.match(/lat=(-?\d+\.\d+).*?(?:lon|lng)=(-?\d+\.\d+)/);
  if (m) { $('f-lat').value = m[1]; $('f-lon').value = m[2]; }
  const z = s.match(/[?&]z(?:oom)?=(\d+)/) || s.match(/,(\d+(?:\.\d+)?)z/);
  if (z) $('f-zoom').value = Math.min(17, Math.round(+z[1]));
});

$('useGps').onclick = () => {
  if (!navigator.geolocation) return alert('אין גישה למיקום במכשיר הזה');
  navigator.geolocation.getCurrentPosition(
    p => { $('f-lat').value = p.coords.latitude.toFixed(5); $('f-lon').value = p.coords.longitude.toFixed(5); },
    err => alert('לא הצלחתי לקבל מיקום: ' + err.message), { enableHighAccuracy: true, timeout: 10000 });
};

$('saveLoc').onclick = () => {
  const lat = parseFloat($('f-lat').value), lon = parseFloat($('f-lon').value);
  const name = $('f-name').value.trim();
  if (!name) return alert('חסר שם');
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return alert('קואורדינטות לא תקינות');
  const data = {
    name, lat, lon,
    zoom: Math.max(3, Math.min(17, parseInt($('f-zoom').value) || 15)),
    low: parseFloat($('f-low').value) || 8,
    high: parseFloat($('f-high').value) || 25,
  };
  let L;
  if (editingId) { L = locations.find(x => x.id === editingId); Object.assign(L, data); }
  else { L = { id: crypto.randomUUID?.() || String(Date.now()), history: [], roi: null, ...data }; locations.push(L); }
  save(locations);
  openDetail(L);
};

$('delLoc').onclick = () => {
  if (!confirm('למחוק את המיקום?')) return;
  locations = locations.filter(x => x.id !== editingId);
  save(locations); renderList(); show('list');
};

// ---------- detail ----------
const embedUrl = L => `https://embed.waze.com/iframe?zoom=${L.zoom}&lat=${L.lat}&lon=${L.lon}&pin=1`;
const wazeAppUrl = L => `https://waze.com/ul?ll=${L.lat},${L.lon}&z=${L.zoom}`;

function openDetail(L) {
  currentLoc = L;
  roi = L?.roi || null;
  $('result').classList.add('hidden');
  const hasLoc = !!L;
  document.querySelector('.mapwrap').classList.toggle('hidden', !hasLoc);
  $('openWaze').parentElement.classList.toggle('hidden', !hasLoc);
  $('saveRoi').classList.toggle('hidden', !hasLoc);
  if (hasLoc) { $('wazeFrame').src = embedUrl(L); $('openWaze').href = wazeAppUrl(L); }
  renderHistory();
  show('detail', L ? L.name : 'ניתוח מהיר');
}

function renderHistory() {
  const h = currentLoc?.history || [];
  $('history').innerHTML = h.length
    ? h.map(r => { const v = verdict(r, currentLoc); return `<tr><td>${fmtTime(r.t)}</td><td style="color:${v.color}">${v.text}</td><td>מדד ${r.index.toFixed(0)}</td></tr>`; }).join('')
    : '<tr><td class="muted">אין עדיין בדיקות</td></tr>';
  $('history').parentElement.classList.toggle('hidden', !currentLoc);
}

// ---------- image input & analysis ----------
$('pickImg').onclick = () => $('fileIn').click();
$('quickPick').onclick = () => { openDetail(null); $('fileIn').click(); };
$('fileIn').onchange = e => { const f = e.target.files[0]; if (f) loadImage(f); e.target.value = ''; };

async function loadImage(blob) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  currentImg = img;
  runAnalysis(true);
}

function runAnalysis(record) {
  if (!currentImg) return;
  const stats = analyzeImage(currentImg, { roi });
  const th = currentLoc || { low: 8, high: 25 };
  const v = verdict(stats, th);

  const cv = $('preview');
  cv.width = stats.overlay.width; cv.height = stats.overlay.height;
  cv.getContext('2d').drawImage(stats.overlay, 0, 0);

  $('verdict').textContent = `${v.text} · מדד ${stats.index.toFixed(0)}`;
  $('verdict').style.background = v.color;
  $('stats').innerHTML =
    LEVELS.map(L => `<tr><td><span class="dot" style="display:inline-block;background:${L.color}"></span> ${L.name}</td><td>${(stats.counts[L.id] / stats.total * 100).toFixed(2)}%</td></tr>`).join('') +
    `<tr><td>כיסוי עומס כולל</td><td>${stats.coveragePct.toFixed(2)}%</td></tr>` +
    `<tr><td>חומרה ממוצעת (1–4)</td><td>${stats.severity.toFixed(2)}</td></tr>`;
  $('result').classList.remove('hidden');

  if (record && currentLoc) {
    currentLoc.history = [{ t: Date.now(), index: stats.index, coveragePct: stats.coveragePct, severity: stats.severity },
      ...(currentLoc.history || [])].slice(0, 30);
    save(locations); renderHistory();
  }
}

// ---------- region-of-interest drag ----------
(function roiDrag() {
  const cv = $('preview'); let start = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  cv.addEventListener('pointerdown', e => { start = pos(e); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointerup', e => {
    if (!start) return; const p = pos(e);
    const x = Math.max(0, Math.min(start.x, p.x)), y = Math.max(0, Math.min(start.y, p.y));
    const w = Math.min(1, Math.abs(p.x - start.x)), h = Math.min(1, Math.abs(p.y - start.y));
    start = null;
    if (w > 0.03 && h > 0.03) { roi = { x, y, w, h }; runAnalysis(false); }
  });
})();
$('saveRoi').onclick = () => { if (currentLoc) { currentLoc.roi = roi; save(locations); alert('האזור נשמר למיקום'); } };
$('clearRoi').onclick = () => { roi = null; runAnalysis(false); };

// ---------- image shared from gallery (Share Target) ----------
async function checkShared() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  const c = await caches.open('tlm-shared');
  const res = await c.match('./shared-image');
  if (!res) return;
  await c.delete('./shared-image');
  const blob = await res.blob();
  // If there are saved locations, ask which one this screenshot belongs to
  let L = null;
  if (locations.length) {
    const names = locations.map((x, i) => `${i + 1}. ${x.name}`).join('\n');
    const n = parseInt(prompt(`לאיזה מיקום שייך הצילום? (מספר, ריק = ניתוח מהיר)\n${names}`, '1'));
    L = locations[n - 1] || null;
  }
  openDetail(L);
  loadImage(blob);
}

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
renderList();
checkShared();
