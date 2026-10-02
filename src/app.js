import { periodRange, summarize, dailySeries, parseAmount, toCSV, startOfDay } from './stats.js';

// ---------- Storage ----------
const KEY = 'delivery-ledger.v1';
const DEFAULTS = {
  settings: {
    currency: 'RON',
    platforms: ['Glovo', 'Bolt Food', 'Wolt', 'Direct'],
    categories: ['Fuel', 'Food', 'Parking', 'Phone', 'Other'],
  },
  shifts: [],      // { id, start, end|null }
  deliveries: [],  // { id, ts, platform, pay, tip, km }
  expenses: [],    // { id, ts, category, amount }
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      return { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...raw.settings } };
    }
  } catch { /* fall through to defaults */ }
  return structuredClone(DEFAULTS);
}
let db = load();
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { toast('Could not save — storage is full or blocked'); }
};
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- UI state ----------
const ui = {
  tab: 'today',
  period: 'week',
  platform: db.settings.platforms[0],
  category: db.settings.categories[0],
};

// ---------- Helpers ----------
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const money = (v) => {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: db.settings.currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${db.settings.currency}`;
  }
};
const hm = (hours) => `${Math.floor(hours)}h ${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}m`;
const clockTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const activeShift = () => db.shifts.find((s) => s.end == null);

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { textContent: msg }));
  if (action) t.append(el('button', { textContent: action.label, onclick: () => { action.run(); t.hidden = true; } }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

function chips(container, options, current, onPick) {
  container.replaceChildren(
    ...options.map((o) =>
      el('button', {
        type: 'button', className: 'chip', textContent: o, role: 'radio',
        ariaChecked: String(o === current),
        onclick: () => onPick(o),
      }),
    ),
  );
}

// ---------- Today ----------
function renderShift() {
  const card = $('#shiftCard');
  const s = activeShift();
  card.classList.toggle('on', !!s);
  if (s) {
    const hours = (Date.now() - s.start) / 36e5;
    card.replaceChildren(
      el('div', {},
        el('div', { className: 'status', innerHTML: `<span class="dot"></span>On shift since ${clockTime(s.start)}` }),
        el('div', { className: 'clock', textContent: hm(hours) }),
      ),
      el('button', { className: 'btn', textContent: 'End shift', onclick: endShift }),
    );
  } else {
    card.replaceChildren(
      el('div', {},
        el('div', { className: 'status', innerHTML: '<span class="dot"></span>Off shift' }),
        el('div', { className: 'clock', textContent: 'Ready?' }),
      ),
      el('button', { className: 'btn primary', textContent: 'Start shift', onclick: startShift }),
    );
  }
}

function startShift() {
  db.shifts.push({ id: id(), start: Date.now(), end: null });
  save(); render();
  toast('Shift started — the clock is running');
}

function endShift() {
  const s = activeShift();
  if (!s) return;
  s.end = Date.now();
  save(); render();
  const sum = summarize(db, [s.start, s.end + 1], s.end);
  toast(`Shift done · ${hm((s.end - s.start) / 36e5)} · ${money(sum.net)} net`);
}

function renderToday() {
  renderShift();
  chips($('#platformChips'), db.settings.platforms, ui.platform, (p) => { ui.platform = p; renderToday(); });
  chips($('#expenseChips'), db.settings.categories, ui.category, (c) => { ui.category = c; renderToday(); });

  const range = periodRange('today');
  const s = summarize(db, range);
  const kpi = (k, v) => el('div', { className: 'kpi' }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }));
  $('#todayKpis').replaceChildren(
    kpi('Net today', money(s.net)),
    kpi('Per hour', money(s.perHour)),
    kpi('Deliveries', String(s.count)),
  );

  const items = [
    ...db.deliveries.filter((d) => d.ts >= range[0] && d.ts < range[1]).map((d) => ({ ...d, kind: 'delivery' })),
    ...db.expenses.filter((e) => e.ts >= range[0] && e.ts < range[1]).map((e) => ({ ...e, kind: 'expense' })),
  ].sort((a, b) => b.ts - a.ts);

  const list = $('#todayLog');
  if (!items.length) {
    list.replaceChildren(el('li', { className: 'empty', textContent: 'Nothing yet. Your first drop of the day goes here.' }));
    return;
  }
  list.replaceChildren(
    ...items.map((it) => {
      const isD = it.kind === 'delivery';
      const detail = isD ? [it.tip ? `tip ${money(it.tip)}` : '', it.km ? `${it.km} km` : ''].filter(Boolean).join(' · ') : 'expense';
      return el('li', {},
        el('span', { className: 't', textContent: clockTime(it.ts) }),
        el('span', { className: 'what' }, isD ? it.platform : it.category, el('small', { textContent: detail })),
        el('span', { className: 'amt' + (isD ? '' : ' neg'), textContent: (isD ? '+' : '−') + money(isD ? it.pay + (it.tip || 0) : it.amount) }),
        el('button', { className: 'del', ariaLabel: 'Delete', textContent: '✕', onclick: () => removeItem(it) }),
      );
    }),
  );
}

function removeItem(it) {
  const key = it.kind === 'delivery' ? 'deliveries' : 'expenses';
  const idx = db[key].findIndex((x) => x.id === it.id);
  if (idx < 0) return;
  const [removed] = db[key].splice(idx, 1);
  save(); render();
  toast('Deleted', { label: 'Undo', run: () => { db[key].splice(idx, 0, removed); save(); render(); } });
}

$('#deliveryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const pay = parseAmount(f.pay.value);
  if (!pay) { f.pay.focus(); toast('Enter what the delivery paid'); return; }
  db.deliveries.push({ id: id(), ts: Date.now(), platform: ui.platform, pay, tip: parseAmount(f.tip.value), km: parseAmount(f.km.value) });
  if (!activeShift()) toast('Logged. Tip: start a shift to track per-hour pay');
  else toast(`+${money(pay + parseAmount(f.tip.value))} logged`);
  f.reset();
  save(); render();
});

$('#expenseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const amount = parseAmount(f.amount.value);
  if (!amount) { f.amount.focus(); return; }
  db.expenses.push({ id: id(), ts: Date.now(), category: ui.category, amount });
  f.reset();
  $('#expenseBox').open = false;
  save(); render();
  toast(`${ui.category} −${money(amount)} logged`);
});

// ---------- Stats ----------
function renderStats() {
  for (const b of document.querySelectorAll('#periodSeg button')) b.ariaSelected = String(b.dataset.period === ui.period);

  const s = summarize(db, periodRange(ui.period));
  const label = { today: 'today', week: 'this week', month: 'this month', all: 'all time' }[ui.period];

  $('#statsHero').replaceChildren(
    el('div', { className: 'k', textContent: `Net profit ${label}` }),
    el('div', { className: 'v' + (s.net < 0 ? ' neg' : ''), textContent: money(s.net) }),
    el('div', { className: 'sub', textContent: s.perHour != null ? `${money(s.perHour)} per hour worked` : 'Start shifts to see per-hour pay' }),
  );

  const kpi = (k, v) => el('div', { className: 'kpi' }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }));
  $('#statsKpis').replaceChildren(
    kpi('Gross', money(s.gross)),
    kpi('Tips', money(s.tips)),
    kpi('Expenses', money(s.expenses)),
    kpi('Deliveries', String(s.count)),
    kpi('Avg per delivery', money(s.perDelivery)),
    kpi('Hours', s.hours ? hm(s.hours) : '—'),
    kpi('Km', s.km ? s.km.toLocaleString() : '—'),
    kpi('Net per km', money(s.perKm)),
  );

  const span = { today: 7, week: 7, month: Math.max(7, new Date().getDate()), all: 30 }[ui.period];
  $('#chartTitle').textContent = `Net per day · last ${span} days`;
  drawChart(dailySeries(db, span));

  const plats = Object.entries(s.byPlatform).sort((a, b) => b[1].gross - a[1].gross);
  const max = Math.max(1, ...plats.map(([, p]) => p.gross));
  $('#platforms').replaceChildren(
    ...(plats.length
      ? plats.map(([name, p]) =>
          el('div', { className: 'plat' },
            el('div', { className: 'head' },
              el('span', { textContent: name }),
              el('span', { textContent: `${money(p.gross)} · ${p.count} × · ${money(p.gross / p.count)} avg` }),
            ),
            el('div', { className: 'track' }, el('div', { className: 'fill', style: `width:${(p.gross / max) * 100}%` })),
          ))
      : [el('div', { className: 'empty', textContent: 'No deliveries in this period.' })]),
  );
}

function drawChart(series) {
  const W = 340, H = 150, pad = 18, bottom = 20;
  const vals = series.map((d) => d.net);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const y = (v) => pad + ((max - v) / (max - min)) * (H - pad - bottom);
  const bw = (W - 8) / series.length;
  const showEvery = series.length > 10 ? Math.ceil(series.length / 7) : 1;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net profit per day">`;
  svg += `<line class="axis" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
  series.forEach((d, i) => {
    const x = 4 + i * bw + bw * 0.15;
    const top = Math.min(y(d.net), y(0));
    const h = Math.max(d.net === 0 ? 0 : 2, Math.abs(y(d.net) - y(0)));
    svg += `<rect class="bar${d.net < 0 ? ' neg' : ''}" x="${x}" y="${top}" width="${bw * 0.7}" height="${h}" rx="3"><title>${new Date(d.day).toLocaleDateString()}: ${money(d.net)}</title></rect>`;
    if ((series.length - 1 - i) % showEvery === 0) {
      const dt = new Date(d.day);
      const lbl = series.length <= 7 ? dt.toLocaleDateString([], { weekday: 'short' }) : dt.getDate();
      svg += `<text x="${x + bw * 0.35}" y="${H - 5}" text-anchor="middle">${lbl}</text>`;
    }
  });
  svg += `<text x="2" y="11">${money(max)}</text></svg>`;
  $('#chart').innerHTML = svg;
}

$('#periodSeg').addEventListener('click', (e) => {
  const p = e.target.closest('button')?.dataset.period;
  if (p) { ui.period = p; renderStats(); }
});

// ---------- Settings ----------
function renderSettings() {
  const f = $('#settingsForm');
  f.currency.value = db.settings.currency;
  f.platforms.value = db.settings.platforms.join(', ');
  f.categories.value = db.settings.categories.join(', ');
}

const splitList = (v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];

$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const currency = f.currency.value.trim().toUpperCase() || 'RON';
  try { new Intl.NumberFormat(undefined, { style: 'currency', currency }); }
  catch { toast(`"${currency}" isn’t a currency code`); return; }
  const platforms = splitList(f.platforms.value);
  const categories = splitList(f.categories.value);
  if (!platforms.length || !categories.length) { toast('Keep at least one platform and one category'); return; }
  db.settings = { currency, platforms, categories };
  if (!platforms.includes(ui.platform)) ui.platform = platforms[0];
  if (!categories.includes(ui.category)) ui.category = categories[0];
  save(); render();
  toast('Settings saved');
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date(startOfDay(Date.now())).toISOString().slice(0, 10);

$('#exportCsv').onclick = () => download(`delivery-ledger-${stamp()}.csv`, toCSV(db), 'text/csv');
$('#exportJson').onclick = () => download(`delivery-ledger-backup-${stamp()}.json`, JSON.stringify(db, null, 2), 'application/json');
$('#importJson').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.deliveries) || !Array.isArray(data.shifts)) throw new Error();
    if (!confirm('Replace everything on this device with this backup?')) return;
    db = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...data.settings } };
    save(); render();
    toast(`Restored ${db.deliveries.length} deliveries`);
  } catch {
    toast('That file isn’t a Delivery Ledger backup');
  } finally {
    e.target.value = '';
  }
};
$('#wipe').onclick = () => {
  if (!confirm('Delete every delivery, expense and shift on this device? This can’t be undone.')) return;
  db = structuredClone(DEFAULTS);
  save(); render();
  toast('All data deleted');
};

// ---------- Tabs & render loop ----------
document.querySelector('.tabs').addEventListener('click', (e) => {
  const t = e.target.closest('button')?.dataset.tab;
  if (!t) return;
  ui.tab = t;
  render();
  window.scrollTo({ top: 0 });
});

function render() {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== ui.tab;
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  const today = summarize(db, periodRange('today'));
  $('#topNet').textContent = today.count || today.expenses ? `${money(today.net)} today` : '';
  if (ui.tab === 'today') renderToday();
  if (ui.tab === 'stats') renderStats();
  if (ui.tab === 'settings') renderSettings();
}

render();
// Keep the shift clock ticking without re-rendering inputs.
setInterval(() => { if (ui.tab === 'today' && activeShift()) renderShift(); }, 30_000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
