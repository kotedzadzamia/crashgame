// Tiny WebAudio synth: no audio assets needed.

let ctx = null;
let muted = false;

function ac() {
  if (!ctx) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.12 } = {}) {
  const a = ac();
  if (!a || muted) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sound = {
  setMuted(v) { muted = !!v; },
  get muted() { return muted; },
  unlock() { ac(); },
  spin() { tone(220, 0, 0.08, { type: 'triangle', gain: 0.06 }); },
  reelStop(i) { tone(140 + i * 25, 0, 0.07, { type: 'square', gain: 0.05 }); },
  win(size = 1) {
    const notes = size > 2 ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    notes.forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', gain: 0.1 }));
  },
  bonus() {
    [392, 523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, { type: 'sawtooth', gain: 0.05 }));
  },
  click() { tone(880, 0, 0.03, { type: 'square', gain: 0.03 }); },
};
