// Browser front-end: reel animation, win presentation, controls and the
// provably-fair panel. All game math lives in engine.js / game.js.

import {
  SYMBOLS, PAYTABLE, SCATTER_PAYS, PAYLINES, LINE_COLORS, REEL_STRIPS, REELS, ROWS,
  BET_LEVELS, DEFAULT_BET_INDEX, STARTING_BALANCE, FREE_SPINS,
} from './config.js';
import { gridFromStops } from './engine.js';
import { FairRng, verifySpin } from './fair.js';
import { SlotGame } from './game.js';
import { sound } from './audio.js';

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (cents) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// localStorage is a per-browser convenience only; failures are non-fatal.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`lucky-reels:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`lucky-reels:${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

// ---------- state ----------
const savedBalance = store.get('balance', STARTING_BALANCE);
const savedBetIndex = store.get('betIndex', DEFAULT_BET_INDEX);
let betIndex = Number.isInteger(savedBetIndex) && BET_LEVELS[savedBetIndex] ? savedBetIndex : DEFAULT_BET_INDEX;
let autoRemaining = 0;
let spinning = false;
let currentSpin = null;            // result being animated; hides bonus state until reels land
let turbo = store.get('turbo', false) === true;
const pendingStops = new Set();   // finish callbacks for reels still moving (slam-stop)
const revealedSeeds = new Map();  // serverSeedHash -> revealed seed record

const rng = new FairRng({ clientSeed: store.get('clientSeed', undefined) });
let game;

const reelEls = [];
let currentGrid = gridFromStops(REEL_STRIPS.map((s) => Math.floor(Math.random() * s.length))); // cosmetic only

sound.setMuted(store.get('muted', false) === true);

// ---------- rendering: reels ----------
function makeCell(id, extra = '') {
  const sym = SYMBOLS[id];
  const cell = el('div', `cell ${extra}`.trim());
  if (sym.wild) cell.classList.add('wild');
  if (sym.scatter) cell.classList.add('scatter');
  cell.dataset.symbol = id;
  const glyph = el('span', 'glyph', sym.glyph);
  glyph.setAttribute('aria-hidden', 'true');
  cell.append(glyph);
  if (sym.wild || sym.scatter) cell.append(el('span', 'tag', sym.label.toUpperCase()));
  return cell;
}

function buildReels() {
  const reels = $('reels');
  reels.setAttribute('role', 'img');
  for (let r = 0; r < REELS; r++) {
    const reel = el('div', 'reel');
    const strip = el('div', 'strip');
    reel.append(strip);
    reels.append(reel);
    reelEls.push({ reel, strip });
  }
  renderGrid(currentGrid);
}

function renderGrid(grid) {
  grid.forEach((col, r) => reelEls[r].strip.replaceChildren(...col.map((id) => makeCell(id))));
  $('reels').setAttribute('aria-label', describeGrid(grid));
}

function describeGrid(grid) {
  const rows = [];
  for (let row = 0; row < ROWS; row++) rows.push(grid.map((c) => SYMBOLS[c[row]].label).join(', '));
  return `Reels — top: ${rows[0]}; middle: ${rows[1]}; bottom: ${rows[2]}`;
}

/** Animate every reel from the current symbols down to the target grid. */
function animateReels(grid, stops) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const promises = grid.map((targetCol, r) => new Promise((resolve) => {
    const { strip } = reelEls[r];
    const s = REEL_STRIPS[r];
    const fillerCount = (turbo ? 6 : 14) + r * (turbo ? 3 : 5);
    const filler = Array.from({ length: fillerCount }, (_, i) => s[(stops[r] + ROWS + i) % s.length]);
    const ids = [...targetCol, ...filler, ...currentGrid[r]];
    const cells = ids.map((id, i) => makeCell(id, i < ROWS ? 'target' : ''));
    const shift = ((ids.length - ROWS) / ids.length) * 100;
    const duration = reduced ? 150 : (turbo ? 380 : 900) + r * (turbo ? 110 : 260);

    strip.replaceChildren(...cells);
    strip.style.transition = 'none';
    strip.style.transform = `translateY(-${shift}%)`;
    void strip.offsetHeight; // force reflow so the start position applies
    strip.classList.add('spinning');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pendingStops.delete(finish);
      clearTimeout(timer);
      strip.removeEventListener('transitionend', finish);
      strip.classList.remove('spinning');
      strip.style.transition = 'none';
      strip.style.transform = '';
      strip.replaceChildren(...targetCol.map((id) => makeCell(id)));
      sound.reelStop(r);
      resolve();
    };
    const timer = setTimeout(finish, duration + 200);
    strip.addEventListener('transitionend', finish, { once: true });
    pendingStops.add(finish);

    requestAnimationFrame(() => {
      strip.style.transition = `transform ${duration}ms cubic-bezier(.18,.72,.32,1.06)`;
      strip.style.transform = 'translateY(0)';
    });
  }));
  return Promise.all(promises);
}

function slamStop() {
  // Stop reels in order so the reel-stop sounds still cascade.
  [...pendingStops].forEach((finish, i) => setTimeout(finish, i * 40));
}

// ---------- rendering: wins ----------
function cellAt(reel, row) { return reelEls[reel].strip.children[row]; }

function clearWins() {
  $('lines-overlay').replaceChildren();
  document.querySelectorAll('.cell.win, .cell.dim').forEach((c) => {
    c.classList.remove('win', 'dim');
    c.style.removeProperty('--win-color');
  });
  $('win-splash').hidden = true;
}

function showWins(result) {
  const overlay = $('lines-overlay');
  const frame = overlay.getBoundingClientRect();
  overlay.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  const winning = new Set();
  const svgNS = 'http://www.w3.org/2000/svg';

  for (const w of result.lineWins) {
    const color = LINE_COLORS[w.line % LINE_COLORS.length];
    const points = PAYLINES[w.line].map((row, reel) => {
      const b = cellAt(reel, row).getBoundingClientRect();
      return `${b.left - frame.left + b.width / 2},${b.top - frame.top + b.height / 2}`;
    }).join(' ');
    const poly = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('points', points);
    poly.setAttribute('stroke', color);
    overlay.append(poly);
    for (const [reel, row] of w.positions) {
      const c = cellAt(reel, row);
      c.style.setProperty('--win-color', color);
      winning.add(c);
    }
  }
  if (result.scatter.win > 0 || result.freeSpinsAwarded > 0) {
    for (const [reel, row] of result.scatter.positions) {
      const c = cellAt(reel, row);
      c.style.setProperty('--win-color', '#4cc9f0');
      winning.add(c);
    }
  }
  if (!winning.size) return;
  reelEls.forEach(({ strip }) => [...strip.children].forEach((c) => {
    c.classList.add(winning.has(c) ? 'win' : 'dim');
  }));
}

function describeWin(result) {
  const parts = result.lineWins.map((w) =>
    `Line ${w.line + 1}: ${w.count}× ${SYMBOLS[w.symbol].glyph} ${fmt(w.win)}`);
  if (result.scatter.win) parts.push(`${result.scatter.count}× ${SYMBOLS.SCATTER.glyph} ${fmt(result.scatter.win)}`);
  return parts.join(' · ');
}

async function splash(title, amount, ms) {
  $('win-splash-title').textContent = title;
  $('win-splash-amount').textContent = amount;
  $('win-splash').hidden = false;
  await wait(ms);
  $('win-splash').hidden = true;
}

function countUp(node, to, ms) {
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (t) => {
      const p = Math.min(1, (t - start) / ms);
      node.textContent = fmt(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

// ---------- rendering: HUD ----------
function setMessage(text, kind = '') {
  const m = $('message');
  m.textContent = text;
  m.className = `message ${kind}`.trim();
}

function updateHud(displayBalance = game.balance) {
  const bet = BET_LEVELS[betIndex];
  $('balance').textContent = fmt(displayBalance);
  $('bet').textContent = fmt(game.inBonus ? game.freeSpinBet : bet);

  const locked = spinning || game.inBonus || autoRemaining > 0;
  $('bet-down').disabled = locked || betIndex === 0;
  $('bet-up').disabled = locked || betIndex === BET_LEVELS.length - 1;

  const btn = $('btn-spin');
  btn.classList.toggle('stop', spinning || autoRemaining > 0);
  btn.classList.toggle('free', !spinning && game.inBonus);
  btn.textContent = spinning ? 'STOP' : autoRemaining > 0 ? `AUTO ${autoRemaining}` : game.inBonus ? 'FREE' : 'SPIN';
  btn.disabled = !spinning && !game.inBonus && game.balance < bet && autoRemaining === 0;

  const banner = $('bonus-banner');
  banner.hidden = spinning ? !currentSpin?.isFree : !game.inBonus;
  $('fs-left').textContent = String(game.freeSpins);
  $('fs-mult').textContent = String(FREE_SPINS.multiplier);
  $('fs-total').textContent = fmt(game.bonusWin);

  $('reset-balance').hidden = spinning || game.inBonus || game.balance >= BET_LEVELS[0];
  $('fair-hash').textContent = rng.serverSeedHash;
  $('fair-nonce').textContent = String(rng.nonce);
  $('btn-rotate').disabled = spinning;
}

// ---------- spin flow ----------
async function spin() {
  if (spinning) { slamStop(); return; }
  const bet = BET_LEVELS[betIndex];
  if (!game.canSpin(bet)) {
    stopAuto();
    setMessage('Insufficient balance — lower your bet or reset the demo balance.', 'error');
    updateHud();
    return;
  }

  sound.unlock();
  sound.spin();
  clearWins();
  spinning = true;

  let result;
  try {
    result = await game.spin(bet);
  } catch (err) {
    spinning = false;
    stopAuto();
    setMessage(err.message, 'error');
    updateHud();
    return;
  }

  currentSpin = result;
  setMessage(result.isFree ? `Free spin — ${result.freeSpinsLeft} left` : 'Spinning…');
  updateHud(result.balance - result.totalWin);
  $('last-win').textContent = fmt(0);

  await animateReels(result.grid, result.stops);
  currentGrid = result.grid;
  $('reels').setAttribute('aria-label', describeGrid(result.grid));
  showWins(result);
  store.set('balance', game.balance);

  const pace = turbo ? 0.5 : 1;
  if (result.totalWin > 0) {
    const x = result.totalWin / result.bet;
    setMessage(describeWin(result), 'win');
    sound.win(x >= 15 ? 3 : 1);
    const count = countUp($('last-win'), result.totalWin, x >= 15 ? 1600 * pace : 400);
    if (x >= 50) await splash('Mega Win', fmt(result.totalWin), 2400 * pace);
    else if (x >= 15) await splash('Big Win', fmt(result.totalWin), 1800 * pace);
    await count;
  } else if (!result.freeSpinsAwarded) {
    setMessage(result.isFree ? `No win · ${result.freeSpinsLeft} free spins left` : 'No win — try again!');
  }

  if (result.freeSpinsAwarded) {
    sound.bonus();
    await splash(result.isFree ? 'Retrigger!' : 'Free Spins!', `+${result.freeSpinsAwarded} spins · ×${FREE_SPINS.multiplier}`, 2200 * pace);
    setMessage(`${result.freeSpinsAwarded} free spins awarded — all wins ×${FREE_SPINS.multiplier}!`, 'win');
  }
  if (result.bonusEnded) {
    await splash('Bonus Total', fmt(result.bonusWin), 2200 * pace);
    setMessage(`Free spins complete — you won ${fmt(result.bonusWin)}`, 'win');
  }

  spinning = false;
  currentSpin = null;
  updateHud();
  renderHistory();

  // Chain free spins and autoplay.
  const delay = (result.totalWin > 0 ? 1100 : 350) * pace;
  if (game.inBonus) {
    await wait(delay);
    if (!spinning) spin();
  } else if (autoRemaining > 0) {
    autoRemaining -= 1;
    if (autoRemaining === 0) { stopAuto(); return; }
    updateHud();
    await wait(delay);
    if (!spinning && autoRemaining > 0) spin();
  }
}

function stopAuto() {
  autoRemaining = 0;
  $('auto-count').value = '0';
  if (game) updateHud();
}

// ---------- paytable ----------
function renderPaytable() {
  const bet = BET_LEVELS[betIndex];
  const lineBet = bet / PAYLINES.length;
  const cards = Object.entries(PAYTABLE).map(([id, pays]) => payCard(id, pays, lineBet));
  cards.push(payCard('SCATTER', SCATTER_PAYS, bet));
  $('paytable').replaceChildren(...cards);
}

function payCard(id, pays, unit) {
  const card = el('div', 'pay-card');
  const glyph = el('span', 'glyph', SYMBOLS[id].glyph);
  glyph.title = SYMBOLS[id].label;
  const dl = el('dl');
  Object.entries(pays).sort((a, b) => b[0] - a[0]).forEach(([count, mult]) => {
    dl.append(el('dt', null, `${count}×`), el('dd', null, fmt(mult * unit)));
  });
  card.append(glyph, dl);
  return card;
}

function renderLinesLegend() {
  const items = PAYLINES.map((line, i) => {
    const box = el('div', 'line-mini', `Line ${i + 1}`);
    box.style.setProperty('--line-color', LINE_COLORS[i]);
    const g = el('div', 'mini-grid');
    for (let row = 0; row < ROWS; row++) {
      for (let reel = 0; reel < REELS; reel++) g.append(el('span', line[reel] === row ? 'on' : ''));
    }
    box.append(g);
    return box;
  });
  $('lines-legend').replaceChildren(...items);
}

// ---------- provably fair panel ----------
function renderRevealed() {
  const items = [...revealedSeeds.values()].reverse().map((r) => {
    const item = el('div', 'revealed-item');
    item.append(
      el('b', null, 'Revealed '), el('span', null, `(${r.spins} spins)`), el('br'),
      el('span', null, `Server seed: ${r.serverSeed}`), el('br'),
      el('span', null, `Hash: ${r.serverSeedHash}`), el('br'),
      el('span', null, `Client seed: ${r.clientSeed}`),
    );
    return item;
  });
  $('revealed-list').replaceChildren(...items);
}

function fillVerifier({ serverSeed = '', serverSeedHash, clientSeed, nonce }) {
  const f = $('verify-form').elements;
  f.serverSeed.value = serverSeed;
  f.serverSeedHash.value = serverSeedHash;
  f.clientSeed.value = clientSeed;
  f.nonce.value = String(nonce);
  $('verify-result').replaceChildren(serverSeed ? '' : el('span', 'muted', 'Server seed not revealed yet — rotate the seed to verify this spin.'));
  f.serverSeed.focus();
}

function renderHistory() {
  const rows = game.history.slice(0, 20).map((h) => {
    const row = el('div', 'history-row');
    const middle = h.grid.map((c) => SYMBOLS[c[1]].glyph).join('');
    row.append(
      el('span', 'muted', `#${h.proof.nonce}${h.isFree ? ' FS' : ''}`),
      el('span', 'h-grid', middle),
      el('span', 'h-win', h.totalWin ? `+${fmt(h.totalWin)}` : '—'),
    );
    const btn = el('button', 'btn', 'Verify');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const revealed = revealedSeeds.get(h.proof.serverSeedHash);
      fillVerifier({ ...h.proof, serverSeed: revealed?.serverSeed ?? '' });
    });
    row.append(btn);
    return row;
  });
  $('history').replaceChildren(...(rows.length ? rows : [el('span', 'muted', 'No spins yet.')]));
}

async function onVerify(e) {
  e.preventDefault();
  const f = e.target.elements;
  const out = $('verify-result');
  const nonce = Number(f.nonce.value);
  if (!Number.isInteger(nonce) || nonce < 0) {
    out.replaceChildren(el('span', 'bad', 'Nonce must be a non-negative integer.'));
    return;
  }
  const { hashOk, stops } = await verifySpin({
    serverSeed: f.serverSeed.value.trim(),
    serverSeedHash: f.serverSeedHash.value.trim().toLowerCase(),
    clientSeed: f.clientSeed.value.trim(),
    nonce,
  });
  const grid = gridFromStops(stops);
  const gridText = [0, 1, 2].map((row) => grid.map((c) => SYMBOLS[c[row]].glyph).join(' ')).join('\n');
  const pre = el('pre', null, gridText);
  out.replaceChildren(
    el('div', hashOk ? 'ok' : 'bad', hashOk ? '✔ Server seed matches committed hash' : '✘ Server seed does NOT match hash'),
    el('div', null, `Reel stops: [${stops.join(', ')}]`),
    pre,
  );
}

// ---------- wiring ----------
function bind() {
  $('btn-spin').addEventListener('click', () => {
    if (autoRemaining > 0 && !spinning) { stopAuto(); return; }
    if (autoRemaining > 0 && spinning) { stopAuto(); slamStop(); return; }
    spin();
  });

  const changeBet = (d) => {
    const next = betIndex + d;
    if (next < 0 || next >= BET_LEVELS.length || spinning || game.inBonus) return;
    betIndex = next;
    store.set('betIndex', betIndex);
    sound.click();
    renderPaytable();
    updateHud();
  };
  $('bet-down').addEventListener('click', () => changeBet(-1));
  $('bet-up').addEventListener('click', () => changeBet(1));

  $('auto-count').addEventListener('change', (e) => {
    autoRemaining = Number(e.target.value) || 0;
    updateHud();
    if (autoRemaining > 0 && !spinning) spin();
  });

  const turboBox = $('turbo');
  turboBox.checked = turbo;
  turboBox.addEventListener('change', () => { turbo = turboBox.checked; store.set('turbo', turbo); });

  const soundBtn = $('btn-sound');
  const syncSound = () => {
    soundBtn.textContent = sound.muted ? '🔇' : '🔊';
    soundBtn.setAttribute('aria-pressed', String(!sound.muted));
  };
  syncSound();
  soundBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    store.set('muted', sound.muted);
    syncSound();
  });

  $('btn-paytable').addEventListener('click', () => $('dlg-paytable').showModal());
  $('btn-fair').addEventListener('click', () => {
    $('client-seed').value = rng.clientSeed;
    renderHistory();
    $('dlg-fair').showModal();
  });
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop click
  }

  $('client-seed-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      rng.setClientSeed($('client-seed').value);
      store.set('clientSeed', rng.clientSeed);
      $('verify-result').replaceChildren(el('span', 'ok', 'Client seed updated; nonce reset to 0.'));
    } catch (err) {
      $('verify-result').replaceChildren(el('span', 'bad', err.message));
    }
    updateHud();
  });

  $('btn-rotate').addEventListener('click', async () => {
    if (spinning) return;
    const revealed = await rng.rotate();
    revealedSeeds.set(revealed.serverSeedHash, revealed);
    renderRevealed();
    renderHistory();
    updateHud();
  });

  $('verify-form').addEventListener('submit', onVerify);

  $('reset-balance').addEventListener('click', () => {
    game.balance = STARTING_BALANCE;
    store.set('balance', game.balance);
    setMessage('Demo balance reset. Good luck!');
    updateHud();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, select, textarea, button')) return;
    e.preventDefault();
    $('btn-spin').click();
  });

  window.addEventListener('resize', () => {
    const last = game.history[0];
    if (!spinning && last) { clearWins(); showWins(last); }
  });
}

async function main() {
  const resetBtn = el('button', 'btn btn-gold reset-btn', 'Reset demo balance');
  resetBtn.id = 'reset-balance';
  resetBtn.type = 'button';
  resetBtn.hidden = true;
  $('message').after(resetBtn);

  await rng.init();
  store.set('clientSeed', rng.clientSeed);
  const balance = Number.isInteger(savedBalance) && savedBalance >= 0 ? savedBalance : STARTING_BALANCE;
  game = new SlotGame({ balance, rng });

  buildReels();
  renderPaytable();
  renderLinesLegend();
  renderHistory();
  bind();
  updateHud();
}

main().catch((err) => {
  console.error(err);
  setMessage(`Failed to start: ${err.message}`, 'error');
});
