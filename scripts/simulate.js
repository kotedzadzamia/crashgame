#!/usr/bin/env node
// Monte Carlo RTP simulator. Usage: npm run simulate -- [spins=2000000]
// Uses the real engine and reel strips; outcomes are drawn uniformly per reel
// (equivalent in distribution to the HMAC-based fair RNG, but much faster).

import { randomFillSync } from 'node:crypto';
import { REEL_STRIPS, FREE_SPINS, PAYLINES } from '../src/config.js';
import { resolveSpin } from '../src/engine.js';

const SPINS = Number(process.argv[2] ?? 2_000_000);
const BET = PAYLINES.length * 100; // arbitrary; results are reported as ratios

const buf = new Uint32Array(65536);
let idx = buf.length;
function u32() {
  if (idx >= buf.length) { randomFillSync(buf); idx = 0; }
  return buf[idx++];
}
const randomStops = () => REEL_STRIPS.map((s) => Math.floor((u32() / 2 ** 32) * s.length));

let totalWagered = 0, totalWon = 0, baseWon = 0, bonusWon = 0, scatterWon = 0;
let hits = 0, bonusTriggers = 0, maxWin = 0, sumSq = 0;
const bySymbol = {};

for (let i = 0; i < SPINS; i++) {
  totalWagered += BET;
  const base = resolveSpin(randomStops(), BET);
  let roundWin = base.totalWin;
  baseWon += base.totalWin;
  scatterWon += base.scatter.win;
  for (const w of base.lineWins) bySymbol[w.symbol] = (bySymbol[w.symbol] ?? 0) + w.win;

  if (base.freeSpinsAwarded) {
    bonusTriggers++;
    let left = base.freeSpinsAwarded, awarded = left;
    while (left > 0) {
      left--;
      const fs = resolveSpin(randomStops(), BET, { multiplier: FREE_SPINS.multiplier });
      roundWin += fs.totalWin;
      bonusWon += fs.totalWin;
      if (fs.freeSpinsAwarded) {
        const add = Math.min(fs.freeSpinsAwarded, FREE_SPINS.maxTotal - awarded);
        left += add; awarded += add;
      }
    }
  }

  if (roundWin > 0) hits++;
  totalWon += roundWin;
  const x = roundWin / BET;
  sumSq += x * x;
  if (x > maxWin) maxWin = x;
}

const rtp = totalWon / totalWagered;
const variance = sumSq / SPINS - rtp * rtp;
const sd = Math.sqrt(variance);
const ci = 1.96 * sd / Math.sqrt(SPINS);
const pct = (v) => `${(v * 100).toFixed(2)}%`;

console.log(`Spins simulated     : ${SPINS.toLocaleString()}`);
console.log(`RTP                 : ${pct(rtp)}  (95% CI ±${pct(ci)})`);
console.log(`  base line pays    : ${pct((baseWon - scatterWon) / totalWagered)}`);
console.log(`  base scatter pays : ${pct(scatterWon / totalWagered)}`);
console.log(`  free spins        : ${pct(bonusWon / totalWagered)}`);
console.log(`Hit frequency       : ${pct(hits / SPINS)}`);
console.log(`Bonus frequency     : 1 in ${(SPINS / Math.max(1, bonusTriggers)).toFixed(0)}`);
console.log(`Volatility (SD)     : ${sd.toFixed(2)}x bet`);
console.log(`Max win observed    : ${maxWin.toFixed(1)}x bet`);
console.log('Base line RTP by symbol:');
for (const [s, v] of Object.entries(bySymbol).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(8)} ${pct(v / totalWagered)}`);
}
