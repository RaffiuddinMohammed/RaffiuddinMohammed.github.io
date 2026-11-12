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
  return { topics, leader, biggestPeak };
}
