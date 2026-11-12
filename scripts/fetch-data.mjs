// Pulls live news data into src/_data/*.json. Runs daily in GitHub Actions before the build.
// Every source falls back to the last saved file, so one flaky API never breaks the site.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const DATA = new URL('../src/_data/', import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, type = 'json', tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      // curl, not fetch: GDELT's TLS handshake regularly exceeds Node's fixed 10s connect timeout
      const { stdout: body } = await run('curl', ['-sSfL', '--max-time', '60', '-A', 'news-dashboards/1.0', url],
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
  for (const t of TOPICS) {
    try {
      const q = encodeURIComponent(`${t.query} sourcelang:english`);
      let vol = await get(`${base}&timespan=12m&mode=timelinevol&query=${q}`);
      if ((vol.timeline?.[0]?.data?.length ?? 0) < 120) { // a year should give ~365 days; fall back to 3 months
        await wait(12000);
        vol = await get(`${base}&timespan=3m&mode=timelinevol&query=${q}`);
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

await save('bbc', bbc);
await save('hn', hn);
await save('gdelt', gdelt);
await save('hnHistory', hnHistory);
await save('archive', archive);
