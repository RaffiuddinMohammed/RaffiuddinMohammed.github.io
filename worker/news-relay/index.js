// Live news relay. BBC, Investing.com, Cointelegraph and Google Trends don't allow browsers on other
// sites to read their feeds (no CORS), so the tickers can't fetch them directly. This Worker fetches
// them, caches the result for a minute, and serves JSON the site's pages can read.
import { bbc, business, trends } from '../../scripts/flash-core.mjs';

const TTL = 60; // seconds: breaking news shows within about a minute, and the feeds see ~1 hit a minute
const ALLOWED = [/^https:\/\/raffiuddinmohammed\.github\.io$/, /^https?:\/\/localhost(:\d+)?$/];

const cors = (origin) => ({
  'access-control-allow-origin': ALLOWED.some((re) => re.test(origin)) ? origin : 'https://raffiuddinmohammed.github.io',
  'vary': 'origin',
});

async function build() {
  // each source fails on its own: an empty list tells the page to keep what it already has
  const [b, biz, tr] = await Promise.allSettled([bbc(), business(), trends()]);
  return {
    updated: new Date().toISOString(),
    breaking: b.status === 'fulfilled' ? b.value.breaking : null,
    latest: b.status === 'fulfilled' ? b.value.latest : null,
    business: biz.status === 'fulfilled' ? biz.value : null,
    trending: tr.status === 'fulfilled' ? tr.value : null,
  };
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors(origin), 'access-control-allow-methods': 'GET' } });
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const key = new Request(new URL('/flash', req.url).toString());
    let res = await caches.default.match(key);
    if (!res) {
      res = new Response(JSON.stringify(await build()), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${TTL}` },
      });
      ctx.waitUntil(caches.default.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(cors(origin)).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
