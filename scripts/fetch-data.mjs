// Pulls live news data into src/_data/*.json. Runs daily in GitHub Actions before the build.
// Every source falls back to the last saved file, so one flaky API never breaks the site.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const DATA = new URL('../src/_data/', import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, type = 'json', tries = 3, maxTime = 60) {
  for (let i = 1; i <= tries; i++) {
    try {
      // curl, not fetch: GDELT's TLS handshake regularly exceeds Node's fixed 10s connect timeout
      const { stdout: body } = await run('curl', ['-sSfL', '--max-time', String(maxTime), '-A', 'news-dashboards/1.0', url],
        { maxBuffer: 20 * 1024 * 1024 });
      if (type === 'json') return JSON.parse(body); // GDELT answers rate limits with 200 + plain text
      return body;
    } catch (e) {
      if (i === tries) throw e;
      await wait(30000 * i);
    }
  }
}

async function save(name, build) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) return; // e.g. ONLY=bbc npm run data
  const file = new URL(`${name}.json`, DATA);
  try {
    const data = await build();
    await writeFile(file, JSON.stringify({ updated: new Date().toISOString(), ...data }, null, 2));
    console.log(`✓ ${name}`);
  } catch (e) {
    console.warn(`✗ ${name}: ${e.message} — keeping previous data`);
    try { await readFile(file); } catch { await writeFile(file, JSON.stringify({ updated: null }, null, 2)); }
  }
}

// ---------- 1. GDELT: global news coverage of four topics over 3 months ----------
const TOPICS = [
  { key: 'ai', label: 'AI', query: '"artificial intelligence"' },
  { key: 'climate', label: 'Climate', query: '"climate change"' },
  { key: 'economy', label: 'Inflation', query: 'inflation' },
  { key: 'elections', label: 'Elections', query: 'election' },
];

async function gdelt() {
  const base = 'https://api.gdeltproject.org/api/v2/doc/doc?format=json&timelinesmooth=7';
  const day = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  let prev = [];
  try { prev = JSON.parse(await readFile(new URL('gdelt.json', DATA))).topics ?? []; } catch {}
  const out = [];
  const started = Date.now(), BUDGET = 7 * 60 * 1000; // GDELT can be very slow: never let it sink the deploy
  for (const t of TOPICS) {
    if (Date.now() - started > BUDGET) {
      const old = prev.find((p) => p.key === t.key);
      console.warn(`  gdelt ${t.key}: time budget used up${old ? ' — kept previous' : ''}`);
      if (old) out.push(old);
      continue;
    }
    try {
      const q = encodeURIComponent(`${t.query} sourcelang:english`);
      let vol = await get(`${base}&timespan=12m&mode=timelinevol&query=${q}`, 'json', 2, 90).catch(() => null);
      if ((vol?.timeline?.[0]?.data?.length ?? 0) < 120) { // a year should give ~365 days; fall back to 3 months
        await wait(12000);
        vol = await get(`${base}&timespan=3m&mode=timelinevol&query=${q}`, 'json', 2, 60);
      }
      out.push({ ...t, series: vol.timeline[0].data.map((p) => ({ date: day(p.date), value: +p.value.toFixed(4) })) });
    } catch (e) {
      // Rate-limited topics keep yesterday's series rather than vanishing from the chart
      const old = prev.find((p) => p.key === t.key);
      console.warn(`  gdelt ${t.key}: ${e.message.split('\n').pop()}${old ? ' — kept previous' : ' — no data'}`);
      if (old) out.push(old);
    }
    await wait(12000); // GDELT allows one request per 5s and 429s bursts
  }
  if (!out.length) throw new Error('no topics fetched');
  return { topics: out };
}

// ---------- 2. BBC News: what's in today's headlines ----------
const FEEDS = {
  World: 'world', UK: 'uk', Business: 'business', Politics: 'politics',
  Technology: 'technology', Science: 'science_and_environment', Health: 'health',
};
const STOP = new Set(`a an the and or but of to in on at for from by with as is are was were be been being it its this that these those after before over under into about than then so not no yes his her he she they them their our we you your i my me who what why how when where which says say said new will would could can may might up down out off more most first last two three one year years day days man woman people after amid against says bbc us uk set get gets got make makes made back just also all any some has have had do does did over how what has video watch live why inside life know way time look week weeks month here there now still while being own told tell call calls behind`.split(/\s+/));

const strip = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;|’/g, "'").replace(/&quot;/g, '"').trim();


// Countries for the 3D globe: [name, lat, lon, ...words that mean it in a headline]
const PLACES = [
  ['United Kingdom', 54, -2, 'uk', 'britain', 'british', 'england', 'english', 'scotland', 'scottish', 'wales', 'welsh', 'northern ireland', 'london'],
  ['United States', 39, -98, 'US', 'america', 'american', 'americans', 'washington', 'white house'],
  ['Canada', 56, -106, 'canada', 'canadian'], ['Mexico', 23, -102, 'mexico', 'mexican'],
  ['Brazil', -10, -52, 'brazil', 'brazilian'], ['Argentina', -34, -64, 'argentina', 'argentine'],
  ['Colombia', 4, -73, 'colombia', 'colombian'], ['Venezuela', 7, -66, 'venezuela', 'venezuelan'],
  ['Chile', -33, -71, 'chile', 'chilean'], ['Peru', -10, -76, 'peru', 'peruvian'], ['Cuba', 22, -79, 'cuba', 'cuban'],
  ['Ireland', 53, -8, 'ireland', 'irish'], ['France', 46, 2, 'france', 'french', 'paris'],
  ['Germany', 51, 10, 'germany', 'german', 'berlin'], ['Spain', 40, -4, 'spain', 'spanish'],
  ['Portugal', 39, -8, 'portugal', 'portuguese'], ['Italy', 42, 12, 'italy', 'italian', 'rome'],
  ['Netherlands', 52, 5, 'netherlands', 'dutch'], ['Belgium', 50.5, 4.5, 'belgium', 'belgian'],
  ['Switzerland', 47, 8, 'switzerland', 'swiss'], ['Poland', 52, 19, 'poland', 'polish'],
  ['Sweden', 62, 15, 'sweden', 'swedish'], ['Norway', 62, 10, 'norway', 'norwegian'],
  ['Denmark', 56, 10, 'denmark', 'danish'], ['Finland', 64, 26, 'finland', 'finnish'],
  ['Greece', 39, 22, 'greece', 'greek'], ['Hungary', 47, 19, 'hungary', 'hungarian'],
  ['Romania', 46, 25, 'romania', 'romanian'], ['Ukraine', 49, 32, 'ukraine', 'ukrainian', 'kyiv'],
  ['Russia', 60, 90, 'russia', 'russian', 'moscow', 'kremlin'], ['Turkey', 39, 35, 'turkey', 'turkish'],
  ['Israel', 31, 35, 'israel', 'israeli'], ['Gaza', 31.4, 34.4, 'gaza', 'palestinian', 'palestinians', 'west bank'],
  ['Lebanon', 34, 36, 'lebanon', 'lebanese'], ['Syria', 35, 38, 'syria', 'syrian'],
  ['Iran', 32, 53, 'iran', 'iranian', 'tehran'], ['Iraq', 33, 44, 'iraq', 'iraqi'],
  ['Saudi Arabia', 24, 45, 'saudi'], ['Yemen', 15.5, 48, 'yemen', 'yemeni'], ['Qatar', 25.3, 51.2, 'qatar'],
  ['UAE', 24, 54, 'uae', 'dubai', 'emirates'], ['Egypt', 27, 30, 'egypt', 'egyptian'],
  ['Libya', 27, 17, 'libya', 'libyan'], ['Sudan', 15, 30, 'sudan', 'sudanese'],
  ['Ethiopia', 9, 40, 'ethiopia', 'ethiopian'], ['Kenya', 0, 38, 'kenya', 'kenyan'],
  ['Nigeria', 9, 8, 'nigeria', 'nigerian'], ['Ghana', 8, -1, 'ghana', 'ghanaian'],
  ['South Africa', -29, 24, 'south africa', 'south african'], ['DR Congo', -3, 23, 'congo', 'congolese'],
  ['Uganda', 1, 32, 'uganda', 'ugandan'], ['Somalia', 6, 46, 'somalia', 'somali'],
  ['India', 22, 79, 'india', 'indian', 'delhi'], ['Pakistan', 30, 70, 'pakistan', 'pakistani'],
  ['Afghanistan', 34, 66, 'afghanistan', 'afghan', 'taliban'], ['Bangladesh', 24, 90, 'bangladesh'],
  ['China', 35, 104, 'china', 'chinese', 'beijing'], ['Hong Kong', 22.3, 114.2, 'hong kong'],
  ['Taiwan', 23.7, 121, 'taiwan', 'taiwanese'], ['Japan', 36, 138, 'japan', 'japanese', 'tokyo'],
  ['South Korea', 36, 128, 'south korea', 'south korean', 'seoul'], ['North Korea', 40, 127, 'north korea', 'north korean'],
  ['Vietnam', 16, 106, 'vietnam', 'vietnamese'], ['Thailand', 15, 101, 'thailand', 'thai'],
  ['Myanmar', 21, 96, 'myanmar'], ['Indonesia', -2, 118, 'indonesia', 'indonesian'],
  ['Philippines', 13, 122, 'philippines', 'filipino'], ['Australia', -25, 134, 'australia', 'australian'],
  ['New Zealand', -41, 174, 'new zealand'],
];
const placeMatchers = PLACES.map(([name, lat, lon, ...words]) => ({
  name, lat, lon,
  // "US" only as a capitalised word, so the pronoun "us" never counts as America
  re: words.map((w) => w === 'US' ? /\bUS\b/ : new RegExp(`\\b${w}\\b`, 'i')),
}));
function countPlaces(items) {
  const out = [];
  for (const p of placeMatchers) {
    const hits = items.filter((i) => p.re.some((r) => r.test(i.title)));
    if (hits.length) out.push({
      name: p.name, lat: p.lat, lon: p.lon, count: hits.length,
      bySection: hits.reduce((m, h) => ((m[h.section] = (m[h.section] ?? 0) + 1), m), {}), // colours the globe's dots
      // the headlines behind the beam, newest first, so the globe can list them on click
      stories: hits.slice(0, 8).map(({ title, link, section, date }) => ({ title, link, section, date })),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

async function bbc() {
  const sections = [];
  const seen = new Map();
  for (const [name, path] of Object.entries(FEEDS)) {
    const xml = await get(`https://feeds.bbci.co.uk/news/${path}/rss.xml`, 'text');
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
      title: strip(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      link: strip(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ''),
      date: new Date(strip(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '')).toISOString(),
    })).filter((i) => i.title);
    const last24h = items.filter((i) => Date.now() - Date.parse(i.date) < 864e5);
    sections.push({ name, count: last24h.length });
    for (const i of items) if (!seen.has(i.link)) seen.set(i.link, { ...i, section: name });
  }
  const all = [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
  const words = new Map();
  for (const { title } of all) {
    const uniq = new Set(title.toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/)
      .map((w) => w.replace(/'s$|^'|'$/g, '')).filter((w) => w.length > 2 && !STOP.has(w)));
    for (const w of uniq) words.set(w, (words.get(w) ?? 0) + 1);
  }
  const topWords = [...words].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));
  return { totalStories: all.length, sections: sections.sort((a, b) => b.count - a.count), topWords, places: countPlaces(all), latest: all.slice(0, 12) };
}

// ---------- 3. Hacker News: what the tech world is reading ----------
async function hn() {
  const { hits } = await get('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
  const stories = hits.map((h) => ({
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    discuss: `https://news.ycombinator.com/item?id=${h.objectID}`,
    points: h.points, comments: h.num_comments ?? 0,
    domain: h.url ? new URL(h.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com',
  })).sort((a, b) => b.points - a.points);
  const domains = new Map();
  for (const s of stories) domains.set(s.domain, (domains.get(s.domain) ?? 0) + 1);
  return { stories: stories.slice(0, 10), totalPoints: stories.reduce((a, s) => a + s.points, 0), storyCount: stories.length };
}

// ---------- 4. Hacker News history: the top 3 stories of each of the last 12 months ----------
async function hnHistory() {
  const months = [];
  const now = new Date();
  for (let k = 11; k >= 0; k--) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const { hits } = await get(`https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=3&numericFilters=${encodeURIComponent(`created_at_i>=${from / 1000},created_at_i<${to / 1000}`)}`);
    months.push({
      month: from.toISOString().slice(0, 7),
      stories: hits.map((h) => ({
        title: h.title, points: h.points, comments: h.num_comments ?? 0, date: h.created_at.slice(0, 10),
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        discuss: `https://news.ycombinator.com/item?id=${h.objectID}`,
      })),
    });
    await wait(400);
  }
  return { months };
}

// ---------- 5. Daily archive: today's BBC + HN snapshot, kept forever (one entry per UTC day) ----------
async function archive() {
  const read = async (f) => JSON.parse(await readFile(new URL(f, DATA)));
  const bbc = await read('bbc.json'), hn = await read('hn.json');
  if (!bbc.updated) throw new Error('no BBC data today');
  let days = [];
  try { days = (await read('archive.json')).days ?? []; } catch {}
  const today = {
    date: bbc.updated.slice(0, 10),
    totalStories: bbc.totalStories,
    sections: bbc.sections,
    topWords: bbc.topWords.slice(0, 8),
    places: (bbc.places ?? []).map((p) => ({ ...p, stories: (p.stories ?? []).slice(0, 5) })),
    topHeadlines: bbc.latest.slice(0, 5).map(({ title, link, section }) => ({ title, link, section })),
    hnTop: (hn.stories ?? []).slice(0, 3).map(({ title, url, points }) => ({ title, url, points })),
  };
  days = days.filter((d) => d.date !== today.date).concat(today).sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}

// ---------- 6. Markets: finance headlines, themes and US Treasury yields ----------
// Prices are NOT fetched here: free price APIs only licence personal use, so the page shows prices through
// TradingView's embeddable widgets instead. Headlines come from RSS (link-out, like the BBC page).
const MARKET_FEEDS = [
  ['CNBC', 'https://www.cnbc.com/id/15839069/device/rss/rss.html'],  // Investing
  ['CNBC', 'https://www.cnbc.com/id/10000664/device/rss/rss.html'],  // Finance
  ['CNBC', 'https://www.cnbc.com/id/20910258/device/rss/rss.html'],  // Economy
  ['Yahoo Finance', 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA&region=US&lang=en-US'],
  ['Yahoo Finance', 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EFTSE&region=GB&lang=en-GB'],
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'],
  ['Investing.com', 'https://www.investing.com/rss/news_25.rss'],    // Stock market
  ['Investing.com', 'https://www.investing.com/rss/news_14.rss'],    // Economy
];
// Each theme counts the headlines that match any of its patterns
const THEMES = [
  ['AI and chips', /\bA\.?I\b|artificial intelligence|\bchips?\b|semiconductor|data cent(?:er|re)s?|OpenAI|Anthropic/i],
  ['Interest rates', /\brates?\b|rate cut|rate hike|\bFed\b|Federal Reserve|Powell|Bank of England|\bBoE\b|\bECB\b|bond yields?|Treasur(?:y|ies)/i],
  ['Inflation', /inflation|\bCPI\b|\bPCE\b|consumer prices|price pressures/i],
  ['Earnings', /earnings|quarterly|\bresults\b|revenue|profit|guidance|\bEPS\b/i],
  ['Trade and tariffs', /tariffs?|trade (?:war|deal|talks)|export (?:controls|curbs|rules)|sanctions/i],
  ['Jobs', /\bjobs?\b|payrolls|unemployment|jobless|labou?r market|layoffs/i],
  ['Oil and energy', /\boil\b|crude|\bOPEC\b|\bgas prices\b|diesel|energy prices|Brent/i],
  ['Crypto', /bitcoin|crypto|ether(?:eum)?\b|stablecoin|\bBTC\b/i],
  ['Housing', /housing|mortgage|home sales|house prices|real estate/i],
];
const MAG7 = [
  ['Apple', /\bApple\b|\bAAPL\b|iPhone/], ['Microsoft', /Microsoft|\bMSFT\b|Azure/], ['Nvidia', /Nvidia|\bNVDA\b|Jensen Huang/i],
  ['Alphabet', /Alphabet|Google|\bGOOGL?\b|YouTube|Waymo/], ['Amazon', /Amazon|\bAMZN\b|\bAWS\b/], ['Meta', /\bMeta\b|Facebook|Instagram|WhatsApp|Zuckerberg|\bMETA\b/],
  ['Tesla', /Tesla|\bTSLA\b/],
];
// Homepage picks: must read as market news, not advice columns, listicles or vendor press releases
const MARKET_NEWS = /\bstocks?\b|\bshares?\b|\bDow\b|S&P|Nasdaq|FTSE|futures|Wall Street|rally|sell-?off|slump|surge|\bsinks?\b|\bjumps?\b|\bfalls?\b|\brises?\b|\bslides?\b|tumbles?|record high|\bIPO\b|bond|yields?|dollar|sterling|pound/i;
const NOT_NEWS = /\?\s*$|\b(?:I|I'm|my|you|your)\b|best .* to buy|better buy|passive income|dividend aristocrats|insider buys|everything you need to know|\bwith Microsoft\b|Marketplace|Copilot|\bUnites\b|\bBrings\b|\bHelps\b/i;
const MARKET_TERMS = [...THEMES, ...MAG7].map(([, re]) => re);
function featured(list, n = 3) {
  const ok = list.filter((h) => !NOT_NEWS.test(h.title) && (MARKET_NEWS.test(h.title) || MARKET_TERMS.some((re) => re.test(h.title))));
  // One per source first so a single busy feed (usually Yahoo) can't fill the box, then top up by recency
  const picks = [], used = new Set();
  for (const h of ok) if (picks.length < n && !used.has(h.source)) { picks.push(h); used.add(h.source); }
  for (const h of ok) if (picks.length < n && !picks.includes(h)) picks.push(h);
  return picks.length === n ? picks : list.slice(0, n);
}
const decode = (s) => strip(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
// RSS dates: RFC 822 everywhere except Investing.com, which sends "2026-11-18 12:48:26" (UTC)
const rssDate = (s) => { const d = new Date(/^\d{4}-\d\d-\d\d \d/.test(s) ? s.replace(' ', 'T') + 'Z' : s); return isNaN(d) ? null : d.toISOString(); };

async function treasuryYields() {
  const year = new Date().getUTCFullYear();
  const rows = [];
  for (const y of [year - 1, year]) {
    const csv = await get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`, 'text');
    const [head, ...lines] = csv.trim().split('\n');
    const cols = head.split(',').map((c) => c.replace(/"/g, ''));
    for (const line of lines) {
      const v = line.split(','), [mm, dd, yyyy] = v[0].split('/');
      const pick = (name) => { const n = parseFloat(v[cols.indexOf(name)]); return Number.isFinite(n) ? n : null; };
      rows.push({ date: `${yyyy}-${mm}-${dd}`, y3m: pick('3 Mo'), y2: pick('2 Yr'), y10: pick('10 Yr'), y30: pick('30 Yr') });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const recent = rows.filter((r) => Date.parse(r.date) >= Date.now() - 92 * 864e5 && r.y10 != null);
  if (recent.length < 20) throw new Error(`only ${recent.length} Treasury rows`);
  const latest = recent.at(-1), monthAgo = recent.find((r) => Date.parse(r.date) >= Date.parse(latest.date) - 30 * 864e5);
  // Chart floor: a whole percent at least half a point under the lowest 2/10/30-year yield, so the lines aren't squashed flat
  const low = Math.min(...recent.flatMap((r) => [r.y2, r.y10, r.y30]).filter((v) => v != null));
  return { latest, monthAgo, chartFloor: Math.max(0, Math.floor(low - 0.5)), history: recent };
}

async function markets() {
  const seen = new Map();
  const failed = [];
  for (const [source, url] of MARKET_FEEDS) {
    let xml;
    try { xml = await get(url, 'text', 2, 30); } catch { failed.push(source); continue; }
    for (const [, it] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const title = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
      const link = decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
      const date = rssDate(decode(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ''));
      const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!title || !link || !date || seen.has(key)) continue;
      seen.set(key, { title, link, date, source });
    }
  }
  // Two days is the busiest window every feed still covers; older items are stale feed tails
  const all = [...seen.values()].filter((h) => Date.now() - Date.parse(h.date) < 2 * 864e5)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (all.length < 30) throw new Error(`only ${all.length} market headlines (failed: ${failed.join(', ') || 'none'})`);
  const count = (list) => list.map(([name, re]) => ({ name, count: all.filter((h) => re.test(h.title)).length }))
    .sort((a, b) => b.count - a.count);
  const sources = [...new Set(MARKET_FEEDS.map(([s]) => s))].map((name) => ({ name, count: all.filter((h) => h.source === name).length }));
  let yields = null;
  try { yields = await treasuryYields(); } catch (e) {
    console.warn(`  Treasury yields: ${e.message} — keeping previous`);
    try { yields = JSON.parse(await readFile(new URL('markets.json', DATA))).yields ?? null; } catch {}
  }
  return {
    headlineCount: all.length, sources, themes: count(THEMES), mag7: count(MAG7),
    latest: all.slice(0, 20), featured: featured(all), yields,
  };
}

await save('markets', markets);
await save('bbc', bbc);
await save('hn', hn);
await save('gdelt', gdelt);
await save('hnHistory', hnHistory);
await save('archive', archive);
