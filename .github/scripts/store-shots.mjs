// Captures Daam Kingdom screens for the store listing in a phone-sized browser.
// Two players (host + guest) join the same room so the board can be shown in play.
// Writes PNGs plus explore.json (page text, buttons, inputs) to the output folder.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'https://daam-kingdom.hostreadyllc.chatgpt.site';
const OUT = process.argv[2] || 'store/raw';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 400)); };

const browser = await chromium.launch();
const phone = {
  viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
};

async function snapshot(page, name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const info = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.slice(0, 3000),
    buttons: [...document.querySelectorAll('button, [role=button], a')].map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60),
    inputs: [...document.querySelectorAll('input, textarea, select')].map(i => ({ name: i.name, ph: i.placeholder, type: i.type, id: i.id })),
    scrollH: document.documentElement.scrollHeight,
  }));
  note(name, info);
  return info;
}
async function full(page, name) { await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true }); }
async function click(page, re) {
  const b = page.getByRole('button', { name: re }).first();
  try { await b.click({ timeout: 4000 }); return true; } catch {}
  try { await page.getByText(re).first().click({ timeout: 3000 }); return true; } catch { note('noclick', String(re)); return false; }
}

try {
  const host = await (await browser.newContext(phone)).newPage();
  await host.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await snapshot(host, '01-home');
  await full(host, '01-home');

  // Language variants of the home screen
  for (const [label, name] of [['සි', '02-home-sinhala'], ['த', '03-home-tamil']]) {
    try { await host.getByText(label, { exact: true }).first().click({ timeout: 4000 }); await snapshot(host, name); } catch { note('nolang', label); }
  }
  try { await host.getByText('EN', { exact: true }).first().click({ timeout: 4000 }); } catch {}

  // Host creates a room
  await host.locator('input').first().fill('Ash');
  await click(host, /create room/i);
  await host.waitForTimeout(4000);
  const room = await snapshot(host, '04-host-room');
  await full(host, '04-host-room');

  // Find a room code: from the URL or a code-looking token in the page text
  let code = (room.url.match(/[?&#](?:room|code|r)=([A-Za-z0-9-]+)/) || [])[1];
  if (!code) code = (room.text.match(/\b([A-Z0-9]{4,8})\b/g) || []).find(t => /\d/.test(t) && /[A-Z]/.test(t)) || (room.text.match(/\b(\d{4,6})\b/) || [])[1];
  note('code', code || 'none');

  const guest = await (await browser.newContext(phone)).newPage();
  await guest.goto(room.url !== URL && room.url !== URL + '/' ? room.url : URL, { waitUntil: 'networkidle', timeout: 60000 });
  await snapshot(guest, '05-guest-open');
  const inputs = guest.locator('input');
  const n = await inputs.count();
  if (n > 0) await inputs.nth(0).fill('Nimal');
  if (n > 1 && code) await inputs.nth(1).fill(code);
  else if (code) {
    // Maybe a "Join" button reveals a code field
    await click(guest, /join/i);
    await guest.waitForTimeout(1500);
    const n2 = await guest.locator('input').count();
    for (let i = 0; i < n2; i++) {
      const v = await guest.locator('input').nth(i).inputValue().catch(() => 'x');
      if (!v) { await guest.locator('input').nth(i).fill(i === 0 ? 'Nimal' : code); }
    }
  }
  await snapshot(guest, '06-guest-filled');
  await click(guest, /join/i);
  await guest.waitForTimeout(5000);
  await snapshot(guest, '07-guest-joined');
  await snapshot(host, '08-host-after-join');
  // Start the game if there is a start button
  for (const p of [host, guest]) await click(p, /start|play|begin|ready/i);
  await host.waitForTimeout(4000);
  await snapshot(host, '09-host-board');
  await full(host, '09-host-board');
  await snapshot(guest, '10-guest-board');

  // Save the board DOM structure so moves can be scripted next run
  const dom = await host.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-row],[data-col],[data-square],[data-cell],[class*=cell],[class*=square],[class*=piece],canvas,svg')];
    return cells.slice(0, 80).map(e => ({ tag: e.tagName, cls: e.className?.baseVal ?? e.className, data: { ...e.dataset }, r: e.getBoundingClientRect().toJSON() }));
  });
  note('boardDom', dom);
  fs.writeFileSync(`${OUT}/host.html`, await host.content());
} catch (e) {
  note('error', String(e && e.stack || e));
}
fs.writeFileSync(`${OUT}/explore.json`, JSON.stringify(log, null, 1));
await browser.close();
