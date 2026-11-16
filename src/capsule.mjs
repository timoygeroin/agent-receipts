import { digest } from './digest.mjs';

export const CAPSULE_SCHEMA = 'agent-receipts.capsule.v1';
const SIDE_EFFECTS = ['local', 'external'];
const KEYS = ['schema', 'id', 'intent', 'capability', 'sideEffect', 'maxCostUsd', 'digest'];
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

/**
 * A capsule is a frozen, hashed description of ONE intended effect.
 * It is data, never a privileged instruction.
 */
export function makeCapsule({ id, intent, capability, sideEffect = 'local', maxCostUsd = 0 } = {}) {
  if (!text(id, 140)) throw new Error('ID_REQUIRED');
  if (!text(intent, 5000)) throw new Error('INTENT_REQUIRED');
  if (!text(capability, 160) || !/^[a-z][a-z0-9._:-]*$/i.test(capability)) throw new Error('CAPABILITY_INVALID');
  if (!SIDE_EFFECTS.includes(sideEffect)) throw new Error('SIDE_EFFECT_INVALID');
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0) throw new Error('BUDGET_INVALID');
  const payload = { schema: CAPSULE_SCHEMA, id, intent, capability, sideEffect, maxCostUsd };
  return Object.freeze({ ...payload, digest: digest(payload) });
}

/** Re-derive a capsule received from elsewhere. Returns null if malformed or tampered. */
export function reviveCapsule(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== CAPSULE_SCHEMA) return null;
  if (Object.keys(raw).some(k => !KEYS.includes(k)) || KEYS.some(k => !(k in raw))) return null;
  let canonical;
  try { canonical = makeCapsule(raw); } catch { return null; }
  return canonical.digest === raw.digest ? canonical : null;
}
