// Game session state machine: balance, bet validation, free-spin bonus.
// Independent of the DOM so it can run in Node for tests.

import { BET_LEVELS, FREE_SPINS } from './config.js';
import { resolveSpin } from './engine.js';

export class SlotGame {
  /**
   * @param {{balance:number, rng:{next:()=>Promise<{stops:number[],proof:object}>}}} opts
   */
  constructor({ balance, rng }) {
    if (!Number.isInteger(balance) || balance < 0) throw new RangeError('Balance must be a non-negative integer (cents)');
    this.balance = balance;
    this.rng = rng;
    this.freeSpins = 0;
    this.freeSpinBet = 0;     // bet locked in when the bonus was triggered
    this.bonusWin = 0;        // accumulated win for the current bonus round
    this.bonusAwarded = 0;
    this.busy = false;
    this.history = [];
  }

  get inBonus() { return this.freeSpins > 0; }

  canSpin(bet) {
    if (this.busy) return false;
    if (this.inBonus) return true;
    return BET_LEVELS.includes(bet) && this.balance >= bet;
  }

  async spin(bet) {
    if (this.busy) throw new Error('Spin already in progress');
    this.busy = true;
    try {
      const isFree = this.inBonus;
      const stake = isFree ? this.freeSpinBet : bet;
      if (!isFree) {
        if (!BET_LEVELS.includes(stake)) throw new RangeError('Invalid bet');
        if (this.balance < stake) throw new Error('Insufficient balance');
        this.balance -= stake;
        this.bonusWin = 0;
      } else {
        this.freeSpins -= 1;
      }

      const { stops, proof } = await this.rng.next();
      const result = resolveSpin(stops, stake, { multiplier: isFree ? FREE_SPINS.multiplier : 1 });

      this.balance += result.totalWin;
      if (isFree) this.bonusWin += result.totalWin;

      let awarded = 0;
      if (result.freeSpinsAwarded) {
        if (!isFree) {
          this.freeSpinBet = stake;
          this.bonusAwarded = 0;
        }
        awarded = Math.min(result.freeSpinsAwarded, FREE_SPINS.maxTotal - this.bonusAwarded);
        this.freeSpins += awarded;
        this.bonusAwarded += awarded;
      }

      const entry = {
        ...result,
        bet: stake,
        isFree,
        freeSpinsAwarded: awarded,
        freeSpinsLeft: this.freeSpins,
        bonusEnded: isFree && this.freeSpins === 0,
        bonusWin: this.bonusWin,
        balance: this.balance,
        proof,
        time: Date.now(),
      };
      this.history.unshift(entry);
      if (this.history.length > 100) this.history.pop();
      return entry;
    } finally {
      this.busy = false;
    }
  }
}
