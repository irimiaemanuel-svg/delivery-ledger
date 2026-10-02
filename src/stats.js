// Pure calculation helpers. No DOM, no storage — easy to test with `node --test`.

export const HOUR = 36e5;

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Returns [start, end) timestamps for a named period, in local time. */
export function periodRange(period, now = Date.now()) {
  const today = new Date(startOfDay(now));
  if (period === 'today') {
    const end = new Date(today);
    end.setDate(end.getDate() + 1);
    return [today.getTime(), end.getTime()];
  }
  if (period === 'week') {
    const mondayOffset = (today.getDay() + 6) % 7; // Monday = start of week
    const start = new Date(today);
    start.setDate(start.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return [start.getTime(), end.getTime()];
  }
  if (period === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return [start.getTime(), end.getTime()];
  }
  return [0, Infinity];
}

const inRange = (t, [a, b]) => t >= a && t < b;

/** Hours worked inside a range. An open shift counts up to `now`. */
export function hoursInRange(shifts, range, now = Date.now()) {
  let ms = 0;
  for (const s of shifts) {
    const start = Math.max(s.start, range[0]);
    const end = Math.min(s.end ?? now, range[1], now);
    if (end > start) ms += end - start;
  }
  return ms / HOUR;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function summarize({ deliveries = [], expenses = [], shifts = [] }, range, now = Date.now()) {
  const ds = deliveries.filter((d) => inRange(d.ts, range));
  const es = expenses.filter((e) => inRange(e.ts, range));

  const pay = ds.reduce((s, d) => s + (d.pay || 0), 0);
  const tips = ds.reduce((s, d) => s + (d.tip || 0), 0);
  const km = ds.reduce((s, d) => s + (d.km || 0), 0);
  const spent = es.reduce((s, e) => s + (e.amount || 0), 0);
  const gross = pay + tips;
  const net = gross - spent;
  const hours = hoursInRange(shifts, range, now);

  const byPlatform = {};
  for (const d of ds) {
    const p = (byPlatform[d.platform] ??= { count: 0, gross: 0 });
    p.count += 1;
    p.gross += (d.pay || 0) + (d.tip || 0);
  }
  for (const p of Object.values(byPlatform)) p.gross = round2(p.gross);

  return {
    count: ds.length,
    pay: round2(pay),
    tips: round2(tips),
    gross: round2(gross),
    expenses: round2(spent),
    net: round2(net),
    hours: round2(hours),
    km: round2(km),
    perHour: hours > 0.01 ? round2(net / hours) : null,
    perDelivery: ds.length ? round2(gross / ds.length) : null,
    perKm: km > 0 ? round2(net / km) : null,
    byPlatform,
  };
}

/** Net profit per day for the `days` days ending at `now` (oldest first). */
export function dailySeries(data, days, now = Date.now()) {
  const out = [];
  const end = new Date(startOfDay(now));
  for (let i = days - 1; i >= 0; i--) {
    const a = new Date(end);
    a.setDate(a.getDate() - i);
    const b = new Date(a);
    b.setDate(b.getDate() + 1);
    const s = summarize(data, [a.getTime(), b.getTime()], now);
    out.push({ day: a.getTime(), net: s.net, gross: s.gross, count: s.count });
  }
  return out;
}

/** Parses "12,5" or "12.5" into 12.5. Empty or invalid input gives 0. */
export function parseAmount(v) {
  const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV({ deliveries = [], expenses = [] }) {
  const rows = [['type', 'date', 'time', 'platform_or_category', 'pay', 'tip', 'km', 'expense']];
  const fmt = (t) => {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`];
  };
  const all = [
    ...deliveries.map((d) => ['delivery', ...fmt(d.ts), d.platform, d.pay, d.tip || 0, d.km || '', '', d.ts]),
    ...expenses.map((e) => ['expense', ...fmt(e.ts), e.category, '', '', '', e.amount, e.ts]),
  ].sort((a, b) => a[8] - b[8]);
  for (const r of all) rows.push(r.slice(0, 8));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
