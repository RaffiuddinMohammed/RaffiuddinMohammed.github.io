// Derived numbers for the copy around the charts, computed at build time from the fetched data.
import { readFileSync } from 'node:fs';

const load = (f) => { try { return JSON.parse(readFileSync(new URL(f, import.meta.url))); } catch { return {}; } };

export default function () {
  const gdelt = load('./gdelt.json');
  const topics = (gdelt.topics ?? []).map((t) => {
    const peak = t.series.reduce((a, p) => (p.value > a.value ? p : a), t.series[0]);
    const first = t.series[0].value, last = t.series.at(-1).value;
    return { label: t.label, peak, last, change: Math.round(((last - first) / first) * 100) };
  });
  const leader = [...topics].sort((a, b) => b.last - a.last)[0];
  const biggestPeak = [...topics].sort((a, b) => b.peak.value - a.peak.value)[0];
  // weekly averages for the 3D bar grid: one row per topic, one column per week (Monday starts)
  const slots = { ai: 1, climate: 2, economy: 3, elections: 4 };
  const monday = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  const weekSet = new Set();
  (gdelt.topics ?? []).forEach((t) => t.series.forEach((p) => weekSet.add(monday(p.date))));
  const weeks = [...weekSet].sort().slice(-13);
  const grid = {
    weeks,
    topics: (gdelt.topics ?? []).map((t) => ({
      label: t.label, slot: slots[t.key] ?? 1,
      values: weeks.map((w) => {
        const pts = t.series.filter((p) => monday(p.date) === w);
        return pts.length ? +(pts.reduce((a, p) => a + p.value, 0) / pts.length).toFixed(3) : null;
      }),
    })),
  };
  return { topics, leader, biggestPeak, grid };
}
