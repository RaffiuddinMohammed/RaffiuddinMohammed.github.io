// Flash news for the ticker bar under the nav: BBC breaking/latest + what the UK is searching for.
// Runs every 30 minutes from outages.yml (and before the daily build). Never fails the build:
// if a source is down, its items from the previous run are kept.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../src/_data/flash.json', import.meta.url);
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

async function bbc() {
  const xml = await get('https://feeds.bbci.co.uk/news/rss.xml');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    title: tag(it, 'title'), link: tag(it, 'link').replace(/\?at_.*$/, ''), date: new Date(tag(it, 'pubDate')).toISOString(),
  })).filter((h) => h.title && h.link && !/\/(?:videos|sounds|iplayer)\//.test(h.link))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (items.length < 5) throw new Error(`only ${items.length} BBC items`);
  const fresh = (h) => Date.now() - Date.parse(h.date) < BREAKING_MINUTES * 60e3;
  return { breaking: items.filter(fresh).slice(0, 3), latest: items.filter((h) => !fresh(h)).slice(0, 6) };
}

async function trends() {
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

let prev = {};
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const out = { updated: new Date().toISOString() };
try { Object.assign(out, await bbc()); } catch (e) { console.warn(`BBC: ${e.message} — keeping previous`); out.breaking = []; out.latest = prev.latest ?? []; }
try { out.trending = await trends(); } catch (e) { console.warn(`Trends: ${e.message} — keeping previous`); out.trending = prev.trending ?? []; }
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`flash: ${out.breaking.length} breaking, ${out.latest.length} latest, ${out.trending.length} trending`);
