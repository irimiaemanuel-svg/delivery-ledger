import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, hoursInRange, periodRange, parseAmount, dailySeries, toCSV } from '../src/stats.js';

const H = 36e5;
const t0 = new Date(2026, 9, 2, 10, 0).getTime(); // Fri 2 Oct 2026, 10:00 local

const data = {
  shifts: [{ start: t0, end: t0 + 4 * H }],
  deliveries: [
    { ts: t0 + 0.5 * H, platform: 'Glovo', pay: 15, tip: 5, km: 4 },
    { ts: t0 + 1.5 * H, platform: 'Glovo', pay: 12.5, tip: 0, km: 3 },
    { ts: t0 + 2.5 * H, platform: 'Wolt', pay: 20, tip: 2.5, km: 6 },
  ],
  expenses: [{ ts: t0 + 3 * H, category: 'Fuel', amount: 15 }],
};

test('summarize adds up a shift', () => {
  const s = summarize(data, periodRange('today', t0), t0 + 5 * H);
  assert.equal(s.count, 3);
  assert.equal(s.gross, 55);
  assert.equal(s.tips, 7.5);
  assert.equal(s.expenses, 15);
  assert.equal(s.net, 40);
  assert.equal(s.hours, 4);
  assert.equal(s.perHour, 10);
  assert.equal(s.km, 13);
  assert.deepEqual(s.byPlatform.Glovo, { count: 2, gross: 32.5 });
});

test('open shift counts up to now', () => {
  const shifts = [{ start: t0, end: null }];
  assert.equal(hoursInRange(shifts, [0, Infinity], t0 + 2 * H), 2);
});

test('shift crossing midnight is split between days', () => {
  const late = new Date(2026, 9, 2, 22, 0).getTime();
  const shifts = [{ start: late, end: late + 4 * H }];
  assert.equal(hoursInRange(shifts, periodRange('today', late), late + 5 * H), 2);
});

test('week starts on Monday', () => {
  const [start] = periodRange('week', t0);
  const d = new Date(start);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 28); // Mon 28 Sep 2026
});

test('per-hour is null without shifts', () => {
  const s = summarize({ ...data, shifts: [] }, [0, Infinity], t0 + 5 * H);
  assert.equal(s.perHour, null);
});

test('parseAmount accepts comma decimals and rejects junk', () => {
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount(' 7.333 '), 7.33);
  assert.equal(parseAmount('abc'), 0);
  assert.equal(parseAmount('-3'), 0);
  assert.equal(parseAmount(''), 0);
});

test('dailySeries returns one point per day, oldest first', () => {
  const series = dailySeries(data, 7, t0 + 5 * H);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).net, 40);
  assert.equal(series[0].net, 0);
});

test('CSV escapes commas and quotes', () => {
  const csv = toCSV({ deliveries: [{ ts: t0, platform: 'Shop, "Best"', pay: 10 }], expenses: [] });
  assert.match(csv, /"Shop, ""Best"""/);
  assert.equal(csv.split('\n').length, 2);
});
