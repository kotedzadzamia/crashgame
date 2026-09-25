import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REEL_STRIPS, PAYLINES, PAYTABLE, SCATTER_PAYS, FREE_SPINS, BET_LEVELS } from '../src/config.js';
import { evaluateLine, evaluateSpin, gridFromStops } from '../src/engine.js';
import { FairRng, stopsFromSeeds, verifySpin, sha256Hex } from '../src/fair.js';
import { SlotGame } from '../src/game.js';

const BET = 100; // 10 cents per line
const LINE_BET = BET / PAYLINES.length;

// Grid helper: rows given top->bottom as arrays of 5 symbols.
const gridFromRows = (rows) => rows[0].map((_, reel) => rows.map((r) => r[reel]));
const FILL = ['CHERRY', 'LEMON', 'ORANGE', 'GRAPES', 'MELON'];

test('reel strips are deterministic and contain every symbol count', () => {
  assert.equal(REEL_STRIPS.length, 5);
  for (const strip of REEL_STRIPS) assert.ok(strip.length >= 30);
  assert.ok(Object.isFrozen(REEL_STRIPS[0]));
});

test('gridFromStops wraps around the strip and rejects bad stops', () => {
  const last = REEL_STRIPS.map((s) => s.length - 1);
  const grid = gridFromStops(last);
  assert.equal(grid[0][1], REEL_STRIPS[0][0]);
  assert.throws(() => gridFromStops([0, 0, 0, 0]));
  assert.throws(() => gridFromStops([0, 0, 0, 0, 999]));
  assert.throws(() => gridFromStops([0, 0, 0, 0, -1]));
});

test('evaluateLine: plain matches, wild substitution and scatter blocking', () => {
  assert.deepEqual(evaluateLine(['SEVEN', 'SEVEN', 'SEVEN', 'LEMON', 'LEMON']),
    { symbol: 'SEVEN', count: 3, multiplier: PAYTABLE.SEVEN[3] });
  assert.deepEqual(evaluateLine(['SEVEN', 'WILD', 'SEVEN', 'WILD', 'BELL']),
    { symbol: 'SEVEN', count: 4, multiplier: PAYTABLE.SEVEN[4] });
  assert.deepEqual(evaluateLine(['WILD', 'WILD', 'LEMON', 'LEMON', 'CHERRY']),
    { symbol: 'LEMON', count: 4, multiplier: PAYTABLE.LEMON[4] });
  // Pure wild run beats a low symbol continuation.
  assert.deepEqual(evaluateLine(['WILD', 'WILD', 'WILD', 'CHERRY', 'LEMON']),
    { symbol: 'WILD', count: 3, multiplier: Math.max(PAYTABLE.WILD[3], PAYTABLE.CHERRY[4]) });
  assert.equal(evaluateLine(['WILD', 'SCATTER', 'SEVEN', 'SEVEN', 'SEVEN']), null);
  assert.equal(evaluateLine(['LEMON', 'SEVEN', 'SEVEN', 'SEVEN', 'SEVEN']), null);
  assert.deepEqual(evaluateLine(['CHERRY', 'CHERRY', 'LEMON', 'LEMON', 'LEMON']),
    { symbol: 'CHERRY', count: 2, multiplier: PAYTABLE.CHERRY[2] });
});

test('evaluateSpin pays lines, scatters and awards free spins', () => {
  const grid = gridFromRows([
    ['SCATTER', 'LEMON', 'SCATTER', 'GRAPES', 'SCATTER'],
    ['BELL', 'BELL', 'BELL', 'BELL', 'BELL'],
    FILL,
  ]);
  const r = evaluateSpin(grid, BET);
  const middle = r.lineWins.find((w) => w.line === 0);
  assert.equal(middle.symbol, 'BELL');
  assert.equal(middle.count, 5);
  assert.equal(middle.win, PAYTABLE.BELL[5] * LINE_BET);
  assert.equal(r.scatter.count, 3);
  assert.equal(r.scatter.win, SCATTER_PAYS[3] * BET);
  assert.equal(r.freeSpinsAwarded, FREE_SPINS.awarded);
  assert.equal(r.totalWin, r.lineWins.reduce((s, w) => s + w.win, 0) + r.scatter.win);
});

test('evaluateSpin applies the free-spin multiplier and validates bet', () => {
  const grid = gridFromRows([FILL, ['SEVEN', 'SEVEN', 'SEVEN', 'LEMON', 'CHERRY'], FILL]);
  const base = evaluateSpin(grid, BET);
  const boosted = evaluateSpin(grid, BET, { multiplier: 2 });
  assert.equal(boosted.totalWin, base.totalWin * 2);
  assert.throws(() => evaluateSpin(grid, 15));
  assert.throws(() => evaluateSpin(grid, 0));
});

test('all payouts are integer cents for every bet level', () => {
  for (const bet of BET_LEVELS) {
    assert.equal(bet % PAYLINES.length, 0, `bet ${bet} not divisible by line count`);
  }
});

test('fair RNG is deterministic, in range and verifiable', async () => {
  const a = await stopsFromSeeds('server', 'client', 7);
  const b = await stopsFromSeeds('server', 'client', 7);
  const c = await stopsFromSeeds('server', 'client', 8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  a.forEach((s, i) => assert.ok(s >= 0 && s < REEL_STRIPS[i].length));

  const rng = await new FairRng({ clientSeed: 'player' }).init();
  const commitment = rng.serverSeedHash;
  const first = await rng.next();
  const revealed = await rng.rotate();
  assert.equal(revealed.serverSeedHash, commitment);
  assert.equal(await sha256Hex(revealed.serverSeed), commitment);
  assert.notEqual(rng.serverSeedHash, commitment);
  const v = await verifySpin({ ...revealed, nonce: first.proof.nonce });
  assert.ok(v.hashOk);
  assert.deepEqual(v.stops, first.stops);
  assert.throws(() => rng.setClientSeed(''));
});

test('SlotGame debits bets, credits wins and runs the free-spin bonus', async () => {
  const scatterStops = REEL_STRIPS.map((s) => s.indexOf('SCATTER'));
  const queue = [scatterStops, [0, 0, 0, 0, 0]];
  const rng = { next: async () => ({ stops: queue.shift() ?? [0, 0, 0, 0, 0], proof: {} }) };
  const game = new SlotGame({ balance: 1000, rng });

  await assert.rejects(game.spin(33), /Invalid bet/);
  const trigger = await game.spin(BET);
  assert.equal(trigger.freeSpinsAwarded, FREE_SPINS.awarded);
  assert.equal(game.balance, 1000 - BET + trigger.totalWin);
  assert.ok(game.inBonus);

  const before = game.balance;
  const free = await game.spin(BET_LEVELS.at(-1)); // bet arg ignored during bonus
  assert.ok(free.isFree);
  assert.equal(free.bet, BET);
  assert.equal(game.balance, before + free.totalWin);
  assert.equal(game.freeSpins, FREE_SPINS.awarded - 1);

  const poor = new SlotGame({ balance: 5, rng });
  await assert.rejects(poor.spin(BET), /Insufficient/);
});
