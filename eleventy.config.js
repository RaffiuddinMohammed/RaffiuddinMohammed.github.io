import { HtmlBasePlugin } from '@11ty/eleventy';

export default function (cfg) {
  cfg.addPlugin(HtmlBasePlugin); // rewrites links when the site lives under a sub-path
  cfg.addPassthroughCopy('src/assets');
  // JSON for <script type="application/json"> blocks; escapes "<" so a headline can't close the tag
  cfg.addFilter('json', (v) => JSON.stringify(v).replace(/</g, '\\u003c'));
  // the globe's time slider only needs the date and the countries of each archived day
  cfg.addFilter('globeDays', (days) => (days ?? []).map(({ date, places }) => ({ date, places })));
  cfg.addFilter('monthName', (ym) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }));
  cfg.addFilter('num', (v) => Number(v ?? 0).toLocaleString('en-GB'));
  cfg.addFilter('when', (iso) => iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' UK'
    : 'not yet');
  cfg.addFilter('day', (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }));
  cfg.addFilter('ago', (iso) => {
    const h = Math.round((Date.now() - Date.parse(iso)) / 36e5);
    return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  });
  // outage log helpers
  cfg.addFilter('atLevel', (services, level) => (services ?? []).filter((s) => s.level === level));
  cfg.addFilter('incidentCounts', (list) => Object.entries((list ?? []).reduce((m, i) => ((m[i.service] = (m[i.service] ?? 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })));
  cfg.addFilter('lasted', (start, end) => {
    const m = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 6e4));
    return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 6) / 10} h`.replace('.0 h', ' h') : `${Math.round(m / 1440)} days`;
  });
  return { dir: { input: 'src', output: '_site' }, pathPrefix: process.env.PATH_PREFIX || '/' };
}
