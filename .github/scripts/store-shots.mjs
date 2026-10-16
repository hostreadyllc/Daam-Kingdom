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
  await page.locator('.board .square').nth(idx).click({ timeout: 3000 });
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

  // I play gold (p1, bottom, moving up). Simple 1-ply strategy: capture when possible,
  // promote, and avoid landing where a bot piece can jump me next turn.
  const ME = 'p1', BOT = 'p2';
  const rc = (i) => [i >> 3, i & 7];
  const at = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7) ? null : r * 8 + c;
  function danger(board, d) {
    const [r, c] = rc(d);
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const o = at(r + dr, c + dc), land = at(r - dr, c - dc);
      if (o === null || land === null) continue;
      const p = board[o];
      if (!p.includes(BOT) || board[land]) continue;
      // Bot men move down the board (increasing row): they jump me from the row above.
      if (p.includes('king') || dr === -1) return true;
    }
    return false;
  }
  function score(board, src, dst) {
    const b = board.slice(); const [r0, c0] = rc(src), [r1, c1] = rc(dst);
    let s = Math.random() * 0.5;
    if (Math.abs(r1 - r0) >= 2) { // capture: clear the jumped piece(s) on the diagonal
      const dr = Math.sign(r1 - r0), dc = Math.sign(c1 - c0);
      for (let k = 1; k < Math.abs(r1 - r0); k++) b[at(r0 + dr * k, c0 + dc * k)] = '';
      s += 12;
    }
    b[dst] = b[src]; b[src] = '';
    if (r1 === 0 && !board[src].includes('king')) s += 7;
    if (danger(b, dst)) s -= 9;
    if (r0 === 7 && !board[src].includes('king')) s -= 1.5; // keep the back row
    if (c1 === 0 || c1 === 7) s += 1;
    // Don't leave a friend exposed by moving away
    for (let i = 0; i < 64; i++) if (b[i].includes(ME) && i !== dst && danger(b, i) && !danger(board, i)) s -= 5;
    return s;
  }

  let best = { margin: -99 };
  for (let game = 1; game <= 1; game++) {
    let turn = 0;
    for (turn = 1; turn <= 45; turn++) {
      if (!(await waitMyTurn(page))) break;
      await page.waitForTimeout(500);
      const sq = await squares(page);
      const board = sq.map(s => s.piece);
      const options = [];
      if (await page.locator('.board .square[disabled]').count() > 40) break; // game over
      for (const c of sq.filter(s => s.piece.includes(ME))) {
        const { lit } = await trySelect(page, c.i).catch(() => ({ lit: [] }));
        for (const l of lit) options.push({ src: c.i, dst: l.i, s: score(board, c.i, l.i) });
      }
      if (!options.length) { note('noMove', { game, turn }); break; }
      options.sort((a, b) => b.s - a.s);
      const mv = options[0];
      for (let k = 0; k < 2; k++) {
        const sel = (await squares(page))[mv.src].cls.includes('selected');
        if (sel) break;
        await page.locator('.board .square').nth(mv.src).click();
        await page.waitForTimeout(400);
      }
      if (game === 1 && turn === 3) await shotAt(page, '06-selected-cards', '.player-card.opponent', 8);
      await page.locator('.board .square').nth(mv.dst).click();
      await page.waitForTimeout(900);
      // Multi-jumps: keep going while squares are still lit
      for (let k = 0; k < 5; k++) {
        const s2 = await squares(page);
        const more = s2.filter(s => s.cls.includes('hint'));
        if (!more.length) break;
        await page.locator('.board .square').nth(more[0].i).click();
        await page.waitForTimeout(700);
      }
      // Wait for the bot's reply so the board shows a settled position on my turn
      await waitMyTurn(page, 12000);
      await page.waitForTimeout(500);
      const now = (await squares(page)).map(s => s.piece);
      const me = now.filter(p => p.includes(ME)).length, bot = now.filter(p => p.includes(BOT)).length;
      const kings = now.filter(p => p.includes(ME) && p.includes('king')).length;
      if (bot === 0) { await page.waitForTimeout(2000); await shotAt(page, '31-win', '.player-card.opponent', 8); break; }
      const tag = `g${game}-t${String(turn).padStart(2, '0')}-me${me}-bot${bot}${kings ? '-king' + kings : ''}`;
      note('turn', tag);
      if (turn >= 18 && me >= bot) await shotAt(page, `20-${tag}`, '.player-card.opponent', 8);
      if (me - bot > best.margin) best = { margin: me - bot, tag };
    }
    await page.waitForTimeout(1500);
    const end = await statusText(page);
    const body = await page.evaluate(() => document.body.innerText);
    note('gameOver', { game, turn, won: /ash wins|you win/i.test(body) });
    await shotAt(page, `30-end-g${game}`, '.player-card.opponent', 8);
    if (/ash wins|you win/i.test(body)) break;
    // Rematch
    if (!(await page.getByRole('button', { name: /rematch/i }).first().click({ timeout: 5000 }).then(() => true, () => false))) break;
    await page.waitForTimeout(3000);
  }
  note('best', best);
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
