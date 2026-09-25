// Pure slot math: no randomness, no DOM, no I/O. Given reel stops it
// deterministically produces the grid and the win evaluation, which makes
// it trivially unit-testable and re-playable for audit/verification.

import {
  REELS, ROWS, SYMBOLS, PAYTABLE, SCATTER_PAYS, FREE_SPINS, PAYLINES, REEL_STRIPS,
} from './config.js';

const LINE_COUNT = PAYLINES.length;

/** grid[reel][row] of symbol ids for the given stop positions. */
export function gridFromStops(stops, strips = REEL_STRIPS) {
  if (!Array.isArray(stops) || stops.length !== REELS) {
    throw new RangeError(`Expected ${REELS} reel stops`);
  }
  return stops.map((stop, r) => {
    const strip = strips[r];
    if (!Number.isInteger(stop) || stop < 0 || stop >= strip.length) {
      throw new RangeError(`Invalid stop ${stop} for reel ${r}`);
    }
    const col = [];
    for (let row = 0; row < ROWS; row++) col.push(strip[(stop + row) % strip.length]);
    return col;
  });
}

const isWild = (id) => SYMBOLS[id]?.wild === true;
const isScatter = (id) => SYMBOLS[id]?.scatter === true;

/**
 * Evaluate one payline left-to-right. Wilds substitute for any symbol except
 * scatters. Returns the best of (pure wild run) vs (symbol run incl. wilds).
 * @returns {{symbol:string,count:number,multiplier:number}|null}
 */
export function evaluateLine(symbols) {
  let wildRun = 0;
  while (wildRun < symbols.length && isWild(symbols[wildRun])) wildRun++;

  const wildPay = PAYTABLE.WILD?.[wildRun] ?? 0;
  let best = wildPay > 0 ? { symbol: 'WILD', count: wildRun, multiplier: wildPay } : null;

  if (wildRun < symbols.length) {
    const target = symbols[wildRun];
    if (!isScatter(target)) {
      let count = wildRun;
      while (count < symbols.length && (symbols[count] === target || isWild(symbols[count]))) count++;
      const pay = PAYTABLE[target]?.[count] ?? 0;
      if (pay > 0 && (!best || pay > best.multiplier)) {
        best = { symbol: target, count, multiplier: pay };
      }
    }
  }
  return best;
}

/**
 * Evaluate a full grid.
 * @param {string[][]} grid     grid[reel][row]
 * @param {number} totalBet     total bet in integer cents (multiple of line count)
 * @param {{multiplier?:number}} [opts]
 */
export function evaluateSpin(grid, totalBet, { multiplier = 1 } = {}) {
  if (!Number.isInteger(totalBet) || totalBet <= 0 || totalBet % LINE_COUNT !== 0) {
    throw new RangeError(`Total bet must be a positive integer multiple of ${LINE_COUNT}`);
  }
  const lineBet = totalBet / LINE_COUNT;
  const lineWins = [];

  PAYLINES.forEach((line, lineIndex) => {
    const symbols = line.map((row, reel) => grid[reel][row]);
    const hit = evaluateLine(symbols);
    if (!hit) return;
    lineWins.push({
      line: lineIndex,
      symbol: hit.symbol,
      count: hit.count,
      positions: line.slice(0, hit.count).map((row, reel) => [reel, row]),
      win: hit.multiplier * lineBet * multiplier,
    });
  });

  const scatterPositions = [];
  grid.forEach((col, reel) => col.forEach((id, row) => {
    if (isScatter(id)) scatterPositions.push([reel, row]);
  }));
  const scatterCount = scatterPositions.length;
  const scatterWin = (SCATTER_PAYS[scatterCount] ?? 0) * totalBet * multiplier;
  const freeSpinsAwarded = scatterCount >= FREE_SPINS.triggerCount ? FREE_SPINS.awarded : 0;

  const totalWin = lineWins.reduce((s, w) => s + w.win, 0) + scatterWin;

  return {
    lineWins,
    scatter: { count: scatterCount, positions: scatterPositions, win: scatterWin },
    freeSpinsAwarded,
    multiplier,
    totalWin,
  };
}

/** Convenience: stops -> grid + evaluation. */
export function resolveSpin(stops, totalBet, opts) {
  const grid = gridFromStops(stops);
  return { stops, grid, ...evaluateSpin(grid, totalBet, opts) };
}
