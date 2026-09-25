// Provably fair outcome generation (commit-reveal scheme).
//
//   1. A random server seed is generated and only its SHA-256 hash is shown
//      (the commitment) before any spin.
//   2. The player controls a client seed; every spin increments a nonce.
//   3. Reel stops = HMAC-SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}`),
//      split into 32-bit words and scaled onto each reel strip.
//   4. Rotating the seed reveals the old server seed so any past spin can be
//      recomputed and checked against the published hash.
//
// NOTE: in this client-only demo the "server" seed lives in the browser.
// In a real-money deployment the seed pair and nonce MUST live server-side
// and outcome generation must happen on the server.

import { REEL_STRIPS } from './config.js';

const subtle = globalThis.crypto?.subtle;
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return toHex(a);
}

export async function sha256Hex(text) {
  return toHex(await subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmacSha256(key, message) {
  const k = await subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, enc.encode(message)));
}

/**
 * Deterministically derive reel stops from a seed pair and nonce.
 * Each reel uses its own 32-bit word: stop = floor(u32 / 2^32 * stripLength).
 * Bias is < stripLength / 2^32 (~1e-8), negligible for strip lengths < 100.
 */
export async function stopsFromSeeds(serverSeed, clientSeed, nonce, strips = REEL_STRIPS) {
  if (strips.length * 4 > 32) throw new RangeError('Too many reels for one HMAC block');
  const digest = await hmacSha256(serverSeed, `${clientSeed}:${nonce}`);
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  return strips.map((strip, i) => Math.floor((view.getUint32(i * 4) / 2 ** 32) * strip.length));
}

export class FairRng {
  constructor({ clientSeed } = {}) {
    this.clientSeed = clientSeed || randomHex(8);
    this.serverSeed = null;
    this.serverSeedHash = null;
    this.nonce = 0;
  }

  async init() {
    this.serverSeed = randomHex(32);
    this.serverSeedHash = await sha256Hex(this.serverSeed);
    this.nonce = 0;
    return this;
  }

  /** Next outcome plus the proof data needed to verify it later. */
  async next() {
    if (!this.serverSeed) throw new Error('FairRng not initialised');
    const nonce = this.nonce++;
    const stops = await stopsFromSeeds(this.serverSeed, this.clientSeed, nonce);
    return { stops, proof: { serverSeedHash: this.serverSeedHash, clientSeed: this.clientSeed, nonce } };
  }

  setClientSeed(seed) {
    const s = String(seed ?? '').trim();
    if (!s || s.length > 64) throw new RangeError('Client seed must be 1-64 characters');
    this.clientSeed = s;
    this.nonce = 0;
  }

  /** Reveal the current server seed and commit to a fresh one. */
  async rotate() {
    const revealed = {
      serverSeed: this.serverSeed,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      spins: this.nonce,
    };
    await this.init();
    return revealed;
  }
}

/** Verify a revealed seed matches its commitment and recompute the stops. */
export async function verifySpin({ serverSeed, serverSeedHash, clientSeed, nonce }) {
  const hashOk = (await sha256Hex(serverSeed)) === serverSeedHash;
  const stops = await stopsFromSeeds(serverSeed, clientSeed, nonce);
  return { hashOk, stops };
}
