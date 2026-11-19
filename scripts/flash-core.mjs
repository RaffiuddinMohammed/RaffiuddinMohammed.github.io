// Feed fetching and parsing for the news tickers, shared by the build (scripts/fetch-flash.mjs)
// and the live relay (worker/news-relay), so the two can never disagree about what a slider shows.
// Only uses fetch and web APIs: runs in Node 22 and in a Cloudflare Worker.
const BREAKING_MINUTES = 60; // a BBC top story this fresh is labelled "Breaking"
const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]);
async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (personal dashboard)' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

export async function bbc() {
  const xml = await get('https://feeds.bbci.co.uk/news/rss.xml');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    title: tag(it, 'title'), link: tag(it, 'link').replace(/\?at_.*$/, ''), date: new Date(tag(it, 'pubDate')).toISOString(),
  })).filter((h) => h.title && h.link && !/\/(?:sounds|iplayer)\//.test(h.link)); // news videos stay: BBC often leads with one
  // Keep the feed's order: it is BBC's editorial ranking, so the day's big story stays in "Latest"
  // even when newer, smaller stories land. Sorting by publish time used to push it out.
  if (items.length < 5) throw new Error(`only ${items.length} BBC items`);
  const fresh = (h) => Date.now() - Date.parse(h.date) < BREAKING_MINUTES * 60e3;
  const breaking = items.filter(fresh).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  return { breaking, latest: items.filter((h) => !breaking.includes(h) && !fresh(h)).slice(0, 6) };
}

export async function trends() {
  const xml = await get('https://trends.google.com/trending/rss?geo=GB');
  const traffic = (s) => parseInt((s || '0').replace(/\D/g, ''), 10) || 0;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const news = it.match(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/)?.[1] ?? '';
    return { term: tag(it, 'title'), traffic: tag(it, 'ht:approx_traffic'), title: tag(news, 'ht:news_item_title'),
      link: tag(news, 'ht:news_item_url'), source: tag(news, 'ht:news_item_source') };
  }).filter((t) => t.term && t.link)
    // Google sends search terms in lowercase: "star wars episode iv" -> "Star Wars Episode IV"
    .map((t) => ({ ...t, term: t.term.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(?:I{2,3}|Iv|Vi{1,3}|Ix)\b/g, (r) => r.toUpperCase()) }));
  if (items.length < 3) throw new Error(`only ${items.length} trends`);
  // "im a celeb vote" and "i'm a celeb vote" are the same trend: keep the busiest spelling
  const seen = new Set();
  return items.sort((a, b) => traffic(b.traffic) - traffic(a.traffic))
    .filter((t) => { const k = t.term.toLowerCase().replace(/[^a-z0-9]/g, ''); return !seen.has(k) && seen.add(k); }).slice(0, 5);
}

// Markets page ticker: business, markets, money and crypto only, from finance-specific feeds.
const BUSINESS_FEEDS = [
  ['BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml', true],   // true = broad feed, keep money stories only
  ['CNBC', 'https://www.cnbc.com/id/10000664/device/rss/rss.html', true],    // Finance
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'],
  ['Investing.com', 'https://www.investing.com/rss/news_25.rss'],             // Stock market
  ['Cointelegraph', 'https://cointelegraph.com/rss'],                          // Crypto
];
// a story from a broad feed must mention money to make the bar (drops politics, culture, HR stories)
const MONEY = /\b(?:market|stock|share|shares|shareholder|investor|invest\w*|fund|ipo|price[sd]?|pric\w+|bank\w*|fed|interest|rates?|inflation|economy|economic|gdp|recession|earnings|profit\w*|revenue|sales|deal|merger|takeover|acquisition|tax\w*|tariffs?|trade|budget|debt|bonds?|yields?|mortgage\w*|pensions?|savings?|wages?|pay|jobs?|unemployment|dollar|pound|sterling|euro|currenc\w+|crypto\w*|bitcoin|ether\w*|oil|gold|billion\w*|million\w*|trillion|valuation|valued|ceo|retail\w*|company|companies|firms?|business\w*|bills?|costs?|spending)\b|[$£€]\d/i;
export async function business() {
  const perSource = await Promise.all(BUSINESS_FEEDS.map(async ([source, url, broad]) => {
    try {
      const xml = await get(url);
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
        const d = Date.parse(tag(it, 'pubDate'));
        return { source, title: tag(it, 'title'), link: tag(it, 'link').replace(/\?at_.*$/, ''), date: Number.isNaN(d) ? null : new Date(d).toISOString() };
      }).filter((h) => h.title && h.link && h.date && !/\/(?:videos|sounds|iplayer|av)\//.test(h.link) && (!broad || MONEY.test(h.title)))
        .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3); // max 3 each, so no one source floods the bar
    } catch (e) { console.warn(`${source}: ${e.message}`); return []; }
  }));
  // round-robin: each source's newest first, then each source's second, ... so every source gets a turn
  const seen = new Set(), items = [];
  for (let round = 0; round < 3; round++) {
    perSource.map((list) => list[round]).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))
      .forEach((h) => { const k = h.title.toLowerCase().replace(/[^a-z0-9]/g, ''); if (!seen.has(k)) { seen.add(k); items.push(h); } });
  }
  items.splice(12);
  // finance feeds publish constantly, so "Breaking" means the last 15 minutes here, not the last hour
  items.forEach((h) => { h.breaking = Date.now() - Date.parse(h.date) < 15 * 60e3; });
  if (items.length < 4) throw new Error(`only ${items.length} business items`);
  return items;
}
