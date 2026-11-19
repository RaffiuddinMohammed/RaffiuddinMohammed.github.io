// Flash news for the ticker bar under the nav: BBC breaking/latest + what the UK is searching for.
// Runs every 30 minutes from outages.yml (and before the daily build). Never fails the build:
// if a source is down, its items from the previous run are kept.
import { readFile, writeFile } from 'node:fs/promises';
import { bbc, business, trends } from './flash-core.mjs';

const OUT = new URL('../src/_data/flash.json', import.meta.url);
let prev = {};
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const out = { updated: new Date().toISOString() };
try { Object.assign(out, await bbc()); } catch (e) { console.warn(`BBC: ${e.message} — keeping previous`); out.breaking = []; out.latest = prev.latest ?? []; }
try { out.business = await business(); } catch (e) { console.warn(`Business: ${e.message} — keeping previous`); out.business = prev.business ?? []; }
try { out.trending = await trends(); } catch (e) { console.warn(`Trends: ${e.message} — keeping previous`); out.trending = prev.trending ?? []; }
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`flash: ${out.breaking.length} breaking, ${out.latest.length} latest, ${out.trending.length} trending, ${out.business.length} business`);
