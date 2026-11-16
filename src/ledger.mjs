import { digest } from './digest.mjs';

/**
 * Append-only, hash-chained receipt log. Editing or deleting an earlier entry breaks the chain.
 * Tamper-evident, not tamper-proof: anyone holding the whole log can rewrite all of it.
 */
export class ReceiptLedger {
  #entries = [];
  constructor({ now = () => new Date().toISOString() } = {}) { this.now = now; }

  append(receipt) {
    const prev = this.#entries.at(-1)?.hash ?? 'GENESIS';
    const body = { seq: this.#entries.length, at: this.now(), prev, receipt };
    const entry = Object.freeze({ ...body, hash: digest(body) });
    this.#entries.push(entry);
    return entry;
  }

  entries() { return this.#entries.map(e => structuredClone(e)); }

  /** Latest receipt for a capsule id, or null. */
  latest(capsuleId) {
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      if (this.#entries[i].receipt.capsuleId === capsuleId) return this.#entries[i].receipt;
    }
    return null;
  }

  static verifyChain(entries) {
    let prev = 'GENESIS';
    for (let i = 0; i < entries.length; i++) {
      const { hash, ...body } = entries[i];
      if (body.seq !== i || body.prev !== prev || digest(body) !== hash) return { ok: false, brokenAt: i };
      prev = hash;
    }
    return { ok: true, brokenAt: null };
  }
}
