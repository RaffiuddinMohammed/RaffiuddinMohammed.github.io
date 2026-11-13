// Outage watch: checks the public status pages of major online services and keeps a 30-day incident log.
// Runs every 30 minutes in GitHub Actions (outages.yml). Writes src/_data/outages.json.
// Prints "changed" or "unchanged" so the workflow only commits when something actually moved.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FILE = new URL('../src/_data/outages.json', import.meta.url);
const KEEP_DAYS = 30;
const since = Date.now() - KEEP_DAYS * 864e5;

async function get(url) {
  const { stdout } = await run('curl', ['-sSfL', '--max-time', '30', '--retry', '2', '-A', 'Mozilla/5.0 (outage-watch)', url],
    { maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

// Services on Atlassian Statuspage share one JSON API: current state + their last 50 incidents
const STATUSPAGE = [
  ['Microsoft 365', null], // filled by microsoft() below; listed first so it leads the grid
  ['GitHub', 'www.githubstatus.com'],
  ['Cloudflare', 'www.cloudflarestatus.com'],
  ['OpenAI', 'status.openai.com'],
  ['Atlassian', 'status.atlassian.com'],
  ['Stripe', 'www.stripestatus.com'],
  ['Reddit', 'www.redditstatus.com'],
  ['Dropbox', 'status.dropbox.com'],
  ['Figma', 'status.figma.com'],
  ['Vercel', 'www.vercel-status.com'],
  ['npm', 'status.npmjs.org'],
  ['DigitalOcean', 'status.digitalocean.com'],
].filter(([, host]) => host);

const LEVEL = { none: 'ok', minor: 'minor', major: 'major', critical: 'major', maintenance: 'ok' };

async function statuspage([name, host]) {
  const [sum, inc] = await Promise.all([get(`https://${host}/api/v2/summary.json`), get(`https://${host}/api/v2/incidents.json`)]);
  const open = sum.incidents ?? [];
  return {
    service: { name, level: LEVEL[sum.status.indicator] ?? 'minor', note: open[0]?.name ?? sum.status.description, url: `https://${host}` },
    incidents: (inc.incidents ?? [])
      .filter((i) => Date.parse(i.created_at) > since && i.impact !== 'none')
      .map((i) => ({ service: name, title: i.name, impact: i.impact === 'critical' ? 'major' : i.impact,
        start: i.created_at, end: i.resolved_at ?? null, url: i.shortlink ?? `https://${host}` })),
  };
}

// Google Cloud publishes every incident with start/end
async function google() {
  const all = await get('https://status.cloud.google.com/incidents.json');
  const open = all.filter((i) => !i.end);
  return {
    service: { name: 'Google Cloud', level: open.some((i) => i.severity === 'high') ? 'major' : open.length ? 'minor' : 'ok',
      note: open[0]?.external_desc ?? 'All services operational', url: 'https://status.cloud.google.com' },
    incidents: all.filter((i) => Date.parse(i.begin) > since).map((i) => ({ service: 'Google Cloud', title: i.external_desc,
      impact: i.severity === 'high' ? 'major' : 'minor', start: i.begin, end: i.end ?? null,
      url: `https://status.cloud.google.com/${i.uri ?? ''}` })),
  };
}

// Microsoft 365 and Slack only publish what is happening now, so their history is the log we build ourselves
async function microsoft() {
  const rows = await get('https://status.cloud.microsoft/api/posts/m365Consumer');
  const bad = rows.filter((r) => r.Status && r.Status !== 'Operational');
  return {
    service: { name: 'Microsoft 365', level: bad.some((r) => /outage|interruption/i.test(r.Status)) ? 'major' : bad.length ? 'minor' : 'ok',
      note: bad[0]?.Title || bad[0]?.Status || 'All services operational', url: 'https://status.cloud.microsoft' },
    active: bad.map((r) => ({ service: 'Microsoft 365', title: r.Title || `${r.ServiceDisplayName}: ${r.Status}`,
      impact: /outage|interruption/i.test(r.Status) ? 'major' : 'minor', url: 'https://status.cloud.microsoft', observed: true })),
  };
}

async function slack() {
  const s = await get('https://slack-status.com/api/v2.0.0/current');
  const act = s.active_incidents ?? [];
  return {
    service: { name: 'Slack', level: act.some((i) => i.type === 'outage') ? 'major' : act.length ? 'minor' : 'ok',
      note: act[0]?.title ?? 'All services operational', url: 'https://slack-status.com' },
    active: act.map((i) => ({ service: 'Slack', title: i.title, impact: i.type === 'outage' ? 'major' : 'minor', url: i.url ?? 'https://slack-status.com', observed: true })),
  };
}

let prev = {};
try { prev = JSON.parse(await readFile(FILE)); } catch {}
const now = new Date().toISOString();

const jobs = [microsoft(), ...STATUSPAGE.map(statuspage), google(), slack()];
const names = ['Microsoft 365', ...STATUSPAGE.map(([n]) => n), 'Google Cloud', 'Slack'];
const results = await Promise.allSettled(jobs);

const services = [], incidents = [];
let tracked = (prev.tracked ?? []).filter((t) => !t.end || Date.parse(t.end) > since); // our own log for M365 + Slack
results.forEach((r, i) => {
  const name = names[i];
  if (r.status === 'rejected') {
    console.warn(`✗ ${name}: ${r.reason.message.split('\n')[0]} — keeping previous`);
    const old = prev.services?.find((s) => s.name === name);
    if (old) services.push({ ...old, stale: true });
    incidents.push(...(prev.incidents ?? []).filter((x) => x.service === name)); // duplicates of tracked ones are removed below
    return;
  }
  const v = r.value;
  services.push(v.service);
  if (v.incidents) incidents.push(...v.incidents);
  if (v.active) {
    const key = (x) => `${x.service}|${x.title}`;
    const live = new Set(v.active.map(key));
    for (const a of v.active) if (!tracked.some((t) => key(t) === key(a) && !t.end)) tracked.push({ ...a, start: now, end: null });
    tracked = tracked.map((t) => (t.service === name && !t.end && !live.has(key(t)) ? { ...t, end: now } : t));
  }
  console.log(`✓ ${name}: ${v.service.level}`);
});
incidents.push(...tracked);

// dedupe (a failed source re-adds its previous incidents), newest first
const seen = new Set();
const log = incidents.filter((x) => { const k = `${x.service}|${x.title}|${x.start}`; return !seen.has(k) && seen.add(k); })
  .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));

const out = { services, incidents: log, tracked };
const changed = JSON.stringify(out) !== JSON.stringify({ services: prev.services, incidents: prev.incidents, tracked: prev.tracked });
await writeFile(FILE, JSON.stringify({ checked: now, ...out }, null, 2));
console.log(changed ? 'changed' : 'unchanged');
