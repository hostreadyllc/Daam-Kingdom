// Captures Daam Kingdom screens for the store listing in a phone-sized browser.
// Creates a room, lets Daam Bot join, and plays real moves so the board shows a live game.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'https://daam-kingdom.hostreadyllc.chatgpt.site';
const OUT = process.argv[2] || 'store/raw';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 300)); };

const browser = await chromium.launch();
const phone = {
  viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
};

const scrollTo = (page, sel, offset = 6) => page.evaluate(([s, o]) => {
  const e = document.querySelector(s); if (!e) return false;
  window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - o); return true;
}, [sel, offset]);

async function shotAt(page, name, sel, offset) {
  if (sel) await scrollTo(page, sel, offset);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  note('shot', name);
}
async function shotBoth(page, name) {
  await shotAt(page, `${name}-cards`, '.player-card.opponent', 8);
  await shotAt(page, `${name}-board`, '.board-frame', 150);
}

// State of the board: every square with its classes and piece.
const squares = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.board .square')].map((sq, i) => {
    const p = sq.querySelector('.piece');
    return { i, cls: sq.className.trim().split(/\s+/), piece: p ? p.className.trim() : '' };
  }));
const statusText = (page) => page.evaluate(() => document.querySelector('.status')?.innerText || document.body.innerText.slice(0, 400));

async function waitMyTurn(page, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await statusText(page);
    if (/your turn/i.test(t) && !/waiting/i.test(t)) return true;
    if (/won|wins|lost|game over|victory|defeat/i.test(t)) { note('gameEnd', t); return false; }
    await page.waitForTimeout(500);
  }
  return false;
}

// Click one of my pieces; return the squares that light up as destinations.
async function trySelect(page, idx) {
  const before = await squares(page);
  await page.locator('.board .square').nth(idx).click();
  await page.waitForTimeout(350);
  const after = await squares(page);
  const lit = after.filter((s, k) => s.i !== idx && s.cls.length > before[k].cls.length && !s.piece);
  return { lit, after };
}

try {
  const page = await (await browser.newContext(phone)).newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await shotAt(page, '01-home');
  for (const [label, name] of [['සි', '02-home-sinhala'], ['த', '03-home-tamil']]) {
    try { await page.getByText(label, { exact: true }).first().click({ timeout: 4000 }); await shotAt(page, name); } catch { note('nolang', label); }
  }
  await page.getByText('EN', { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
  await page.locator('input').first().fill('Ash');
  await page.getByRole('button', { name: /create room/i }).first().click();
  await page.waitForTimeout(2500);
  await shotAt(page, '04-waiting', '.player-card.opponent', 8);

  // Find my colour: the piece class that can move once it's my turn
  await waitMyTurn(page, 30000);
  await page.waitForTimeout(800);
  await shotBoth(page, '05-start');

  let mine = null, turn = 0, captured = 0;
  const start = await squares(page);
  const startCount = { p1: start.filter(s => s.piece.includes('p1')).length, p2: start.filter(s => s.piece.includes('p2')).length };
  for (turn = 1; turn <= 40; turn++) {
    if (!(await waitMyTurn(page))) break;
    await page.waitForTimeout(600);
    const sq = await squares(page);
    // Prefer pieces that must capture (the game may mark them); otherwise any of mine.
    const candidates = sq.filter(s => s.piece && (!mine || s.piece.includes(mine)));
    // Forward-most pieces first makes the game develop; shuffle a little for variety.
    candidates.sort((a, b) => (a.i - b.i) * (mine === 'p1' ? 1 : -1) + (Math.random() - 0.5) * 6);
    let moved = false;
    for (const c of candidates) {
      const { lit, after } = await trySelect(page, c.i);
      if (!lit.length) continue;
      if (!mine) mine = c.piece.includes('p1') ? 'p1' : 'p2';
      if (turn === 3) {
        note('selectedClasses', { piece: after[c.i].cls, lit: lit.map(l => l.cls) });
        await shotBoth(page, '06-selected');
      }
      // Prefer a capture: a destination two rows away
      const jump = lit.find(l => Math.abs(Math.floor(l.i / 8) - Math.floor(c.i / 8)) >= 2);
      const dest = jump || lit[Math.floor(Math.random() * lit.length)];
      await page.locator('.board .square').nth(dest.i).click();
      await page.waitForTimeout(900);
      // Multi-jumps: keep clicking lit squares while it's still my turn and something is lit
      for (let k = 0; k < 4; k++) {
        const s2 = await squares(page);
        const more = s2.filter(s => s.cls.length > 2 && !s.piece);
        if (!more.length || !/your turn/i.test(await statusText(page))) break;
        await page.locator('.board .square').nth(more[0].i).click();
        await page.waitForTimeout(700);
      }
      moved = true; break;
    }
    if (!moved) { note('noMove', { turn, status: await statusText(page) }); break; }
    const now = await squares(page);
    const theirs = mine === 'p1' ? 'p2' : 'p1';
    const left = now.filter(s => s.piece.includes(theirs)).length;
    if (left < startCount[theirs] - captured) { captured = startCount[theirs] - left; await shotBoth(page, `07-capture-t${turn}`); }
    if (now.some(s => /king|crown|queen/i.test(s.piece))) { await shotBoth(page, `08-king-t${turn}`); }
    if ([6, 12, 20, 30].includes(turn)) await shotBoth(page, `09-turn${turn}`);
  }
  note('summary', { mine, turns: turn, captured });
  await shotBoth(page, '10-final');
  // Quick chat
  await page.getByText('Well played!', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shotAt(page, '11-chat', '.chat', 300);
  fs.writeFileSync(`${OUT}/final.html`, await page.content());

  // App icon source
  const svg = await page.evaluate(async () => (await fetch('/favicon.svg')).text());
  fs.writeFileSync(`${OUT}/favicon.svg`, svg);
} catch (e) {
  note('error', String(e && e.stack || e));
}
fs.writeFileSync(`${OUT}/explore.json`, JSON.stringify(log, null, 1));
await browser.close();
