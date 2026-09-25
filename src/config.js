// Game configuration: symbols, reel strips, paylines and paytable.
// All payouts are multipliers of the LINE bet, except scatter pays which
// are multipliers of the TOTAL bet. Tune with `npm run simulate`.

export const REELS = 5;
export const ROWS = 3;

export const SYMBOLS = {
  WILD:    { id: 'WILD',    glyph: '⭐', label: 'Wild',    wild: true },
  SCATTER: { id: 'SCATTER', glyph: '💎', label: 'Scatter', scatter: true },
  SEVEN:   { id: 'SEVEN',   glyph: '7️⃣', label: 'Seven' },
  BELL:    { id: 'BELL',    glyph: '🔔', label: 'Bell' },
  MELON:   { id: 'MELON',   glyph: '🍉', label: 'Melon' },
  GRAPES:  { id: 'GRAPES',  glyph: '🍇', label: 'Grapes' },
  ORANGE:  { id: 'ORANGE',  glyph: '🍊', label: 'Orange' },
  LEMON:   { id: 'LEMON',   glyph: '🍋', label: 'Lemon' },
  CHERRY:  { id: 'CHERRY',  glyph: '🍒', label: 'Cherry' },
};

// Line pays: symbol -> { matchCount: multiplier of line bet }
export const PAYTABLE = {
  WILD:   { 3: 60, 4: 300, 5: 2500 },
  SEVEN:  { 3: 30, 4: 150, 5: 1000 },
  BELL:   { 3: 20, 4: 80,  5: 400 },
  MELON:  { 3: 15, 4: 50,  5: 200 },
  GRAPES: { 3: 10, 4: 30,  5: 120 },
  ORANGE: { 3: 6,  4: 20,  5: 80 },
  LEMON:  { 3: 5,  4: 15,  5: 60 },
  CHERRY: { 2: 1,  3: 4,   4: 12, 5: 50 },
};

// Scatter pays anywhere: count -> multiplier of TOTAL bet.
export const SCATTER_PAYS = { 3: 3, 4: 15, 5: 100 };

export const FREE_SPINS = {
  triggerCount: 3,   // scatters needed to trigger / retrigger
  awarded: 10,       // spins awarded per trigger
  multiplier: 2,     // all wins during free spins are multiplied
  maxTotal: 100,     // hard cap on free spins in one bonus round
};

// 10 fixed paylines. Each entry is the row index (0 = top) per reel.
export const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];

export const LINE_COLORS = [
  '#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff',
  '#ff9f1c', '#2ec4b6', '#f72585', '#90be6d', '#e9c46a',
];

// Symbol counts per reel. Strip length = sum of counts.
// Reels 1 and 5 carry fewer wilds/scatters to keep top prizes and the bonus rare.
const REEL_COMPOSITION = [
  { WILD: 1, SCATTER: 1, SEVEN: 2, BELL: 3, MELON: 4, GRAPES: 5, ORANGE: 6, LEMON: 7, CHERRY: 8 },
  { WILD: 2, SCATTER: 2, SEVEN: 2, BELL: 3, MELON: 4, GRAPES: 5, ORANGE: 6, LEMON: 7, CHERRY: 8 },
  { WILD: 2, SCATTER: 2, SEVEN: 2, BELL: 3, MELON: 4, GRAPES: 5, ORANGE: 6, LEMON: 7, CHERRY: 8 },
  { WILD: 2, SCATTER: 2, SEVEN: 2, BELL: 3, MELON: 4, GRAPES: 5, ORANGE: 6, LEMON: 7, CHERRY: 8 },
  { WILD: 2, SCATTER: 1, SEVEN: 2, BELL: 3, MELON: 4, GRAPES: 5, ORANGE: 6, LEMON: 7, CHERRY: 8 },
];

// Deterministic PRNG used ONLY to lay out the fixed reel strips, so the
// strips are identical on every load (and auditable). Never used for outcomes.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStrip(composition, seed) {
  const strip = [];
  for (const [id, count] of Object.entries(composition)) {
    for (let i = 0; i < count; i++) strip.push(id);
  }
  const rand = mulberry32(seed);
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return strip;
}

export const REEL_STRIPS = Object.freeze(
  REEL_COMPOSITION.map((c, i) => Object.freeze(buildStrip(c, 0x5107 + i * 7919)))
);

// Bets in integer cents to avoid floating point drift on balances.
export const BET_LEVELS = [10, 20, 50, 100, 200, 500, 1000];
export const DEFAULT_BET_INDEX = 3;
export const STARTING_BALANCE = 100_000; // 1,000.00 demo credits
