// Posts Outage watch level changes (down, worse, recovered) to a Telegram channel.
// Reads the alerts file written by fetch-outages.mjs. Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID;
// without them it does nothing, so the workflow runs fine before the bot exists.
import { readFile } from 'node:fs/promises';

const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat, OUTAGE_ALERTS_FILE: file } = process.env;
if (!token || !chat) {
  console.log('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset) — skipping');
  process.exit(0);
}

let alerts = [];
try { alerts = JSON.parse(await readFile(file)); } catch { /* no file means nothing changed */ }
if (!alerts.length) {
  console.log('No status changes — nothing to send');
  process.exit(0);
}

const site = JSON.parse(await readFile(new URL('../src/_data/site.json', import.meta.url)));
const page = `${site.url}/dashboards/outages/`;
const RANK = { ok: 0, minor: 1, major: 2 };
const ICON = { ok: '✅', minor: '🟠', major: '🔴' };
const WORD = { ok: 'operational', minor: 'degraded', major: 'major outage' };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const line = (a) => {
  const verb = a.to === 'ok' ? 'recovered' : RANK[a.to] > RANK[a.from] ? WORD[a.to] : `improved to ${WORD[a.to]}`;
  const note = a.to === 'ok' ? '' : `\n${esc(a.note)}`;
  return `${ICON[a.to]} <b>${esc(a.name)}</b>: ${verb}${note}\n<a href="${esc(a.url)}">Status page</a>`;
};

const text = `${alerts.map(line).join('\n\n')}\n\n<a href="${page}">Outage watch</a>`;

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) {
  console.error(`Telegram send failed: HTTP ${res.status} ${body.description ?? ''}`);
  process.exit(1);
}
console.log(`Sent ${alerts.length} change(s) to Telegram`);
