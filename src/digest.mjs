import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted at every depth. */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 of stable JSON. Detects changes; does NOT authenticate who wrote it. */
export const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');
