import { HtmlBasePlugin } from '@11ty/eleventy';

export default function (cfg) {
  cfg.addPlugin(HtmlBasePlugin); // rewrites links when the site lives under a sub-path
  cfg.addPassthroughCopy('src/assets');
  // JSON for <script type="application/json"> blocks; escapes "<" so a headline can't close the tag
  cfg.addFilter('json', (v) => JSON.stringify(v).replace(/</g, '\\u003c'));
  cfg.addFilter('num', (v) => Number(v ?? 0).toLocaleString('en-GB'));
  cfg.addFilter('when', (iso) => iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' UK'
    : 'not yet');
  cfg.addFilter('day', (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }));
  cfg.addFilter('ago', (iso) => {
    const h = Math.round((Date.now() - Date.parse(iso)) / 36e5);
    return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  });
  return { dir: { input: 'src', output: '_site' }, pathPrefix: process.env.PATH_PREFIX || '/' };
}
