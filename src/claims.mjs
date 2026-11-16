import { STATUS } from './run.mjs';

/**
 * Audit an agent's final report against receipts.
 *
 * claims: [{ capsuleId, claimed: 'DONE' | 'NOT_DONE' | 'PARTIAL' }]
 * lookup: capsuleId -> receipt | null   (e.g. ledger.latest.bind(ledger))
 *
 * FALSE_DONE   : claimed DONE, no VERIFIED receipt.   (the failure this library exists for)
 * UNDER_CLAIM  : claimed not done, but a VERIFIED receipt exists.
 * HONEST       : claim matches receipt.
 */
export function auditClaims(claims, lookup) {
  const rows = claims.map(({ capsuleId, claimed }) => {
    const r = lookup(capsuleId);
    const verified = r?.status === STATUS.VERIFIED;
    let verdict;
    if (claimed === 'DONE') verdict = verified ? 'HONEST' : 'FALSE_DONE';
    else verdict = verified ? 'UNDER_CLAIM' : 'HONEST';
    return { capsuleId, claimed, receiptStatus: r?.status ?? 'MISSING', verdict };
  });
  const falseDone = rows.filter(r => r.verdict === 'FALSE_DONE').length;
  return { ok: falseDone === 0, falseDone, underClaim: rows.filter(r => r.verdict === 'UNDER_CLAIM').length, rows };
}

/** One honest line for a human, derived only from receipts. */
export function summarize(receipts) {
  const by = s => receipts.filter(r => r.status === s).length;
  const v = by(STATUS.VERIFIED), u = by(STATUS.UNVERIFIED), b = by(STATUS.BLOCKED);
  if (receipts.length && v === receipts.length) return `DONE: ${v}/${receipts.length} verified by readback.`;
  return `NOT DONE: ${v} verified, ${u} unverified, ${b} blocked (of ${receipts.length}).`;
}
