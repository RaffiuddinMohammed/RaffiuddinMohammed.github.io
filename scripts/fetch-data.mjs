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
  const base = 'https://api.gdeltproject.org/api/v2/doc/doc?format=json&timespan=3m&timelinesmooth=7';
  const day = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  let prev = [];
  try { prev = JSON.parse(await readFile(new URL('gdelt.json', DATA))).topics ?? []; } catch {}
  const out = [];
  for (const t of TOPICS) {
    try {
      const q = encodeURIComponent(`${t.query} sourcelang:english`);
      const vol = await get(`${base}&mode=timelinevol&query=${q}`);
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
  return { totalStories: all.length, sections: sections.sort((a, b) => b.count - a.count), topWords, latest: all.slice(0, 12) };
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

await save('bbc', bbc);
await save('hn', hn);
await save('gdelt', gdelt);
