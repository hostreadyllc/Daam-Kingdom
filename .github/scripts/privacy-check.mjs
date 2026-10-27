import { chromium } from 'playwright';
import fs from 'node:fs';
const out = {};
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('https://daam-kingdom.hostreadyllc.chatgpt.site', { waitUntil: 'networkidle' });
out.links = await p.evaluate(() => [...document.querySelectorAll('a')].map(a => ({ t: a.innerText.trim(), h: a.href })));
for (const l of out.links.filter(l => /privacy|support/i.test(l.t))) {
  const q = await b.newPage();
  const r = await q.goto(l.h, { waitUntil: 'networkidle' }).catch(e => null);
  out[l.t] = { url: q.url(), status: r && r.status(), text: await q.evaluate(() => document.body.innerText).catch(() => '') };
  await q.close();
}
for (const u of ['https://hostreadyllc.github.io/party-lights/privacy.html', 'https://hostreadyllc.github.io/Dice-Roll-Virtual/privacy/', 'https://hostreadyllc.github.io/Daam-Kingdom/privacy.html']) {
  const r = await fetch(u).catch(() => null); out[u] = r ? r.status : 'error';
}
fs.mkdirSync('store/raw', { recursive: true });
fs.writeFileSync('store/raw/privacy-check.json', JSON.stringify(out, null, 1));
await b.close();
