import { reviveCapsule } from './capsule.mjs';

export const RECEIPT_SCHEMA = 'agent-receipts.receipt.v1';
export const STATUS = Object.freeze({ VERIFIED: 'VERIFIED', UNVERIFIED: 'UNVERIFIED', BLOCKED: 'BLOCKED' });

const receipt = (capsule, status, code, extra = {}) => Object.freeze({
  schema: RECEIPT_SCHEMA,
  capsuleId: capsule?.id ?? null,
  capsuleDigest: capsule?.digest ?? null,
  status,
  code,
  host: null,
  estimatedCostUsd: null,
  verification: null,
  ...extra,
});

/**
 * Run one capsule through an adapter and an INDEPENDENT verifier.
 *
 * adapter:   { id, capabilities: string[], estimate(capsule) -> number, execute(capsule) -> any }
 * verify:    ({capsule, result}) -> { ok: boolean, evidence: string }   (must read the world back,
 *            not trust `result`)
 * authorize: ({capsule, estimatedCostUsd}) -> true   (required for external or paid effects)
 *
 * Only VERIFIED means "done". Exceptions after execute() are UNVERIFIED, never success:
 * the effect may have happened anyway.
 */
export async function runEffect(rawCapsule, { adapter, verify, authorize } = {}) {
  const capsule = reviveCapsule(rawCapsule);
  if (!capsule) return receipt(rawCapsule, STATUS.BLOCKED, 'INVALID_OR_TAMPERED_CAPSULE');
  const host = typeof adapter?.id === 'string' ? adapter.id : null;
  if (!host || typeof adapter.execute !== 'function' || !Array.isArray(adapter.capabilities)) {
    return receipt(capsule, STATUS.BLOCKED, 'HOST_INVALID');
  }
  if (!adapter.capabilities.includes(capsule.capability)) return receipt(capsule, STATUS.BLOCKED, 'CAPABILITY_UNAVAILABLE', { host });
  if (typeof verify !== 'function') return receipt(capsule, STATUS.BLOCKED, 'VERIFIER_REQUIRED', { host });
  if (typeof adapter.estimate !== 'function') return receipt(capsule, STATUS.BLOCKED, 'UNKNOWN_COST', { host });

  let cost;
  try { cost = await adapter.estimate(capsule); } catch { cost = NaN; }
  if (!Number.isFinite(cost) || cost < 0) return receipt(capsule, STATUS.BLOCKED, 'UNKNOWN_COST', { host });
  if (cost > capsule.maxCostUsd) return receipt(capsule, STATUS.BLOCKED, 'BUDGET_EXCEEDED', { host, estimatedCostUsd: cost });

  if (capsule.sideEffect === 'external' || cost > 0) {
    let approved = false;
    try { approved = typeof authorize === 'function' && (await authorize({ capsule, host, estimatedCostUsd: cost })) === true; } catch { approved = false; }
    if (!approved) return receipt(capsule, STATUS.BLOCKED, 'AUTHORIZATION_REQUIRED', { host, estimatedCostUsd: cost });
  }

  let result;
  try { result = await adapter.execute(capsule); } catch (error) {
    return receipt(capsule, STATUS.UNVERIFIED, 'EXECUTION_AMBIGUOUS', {
      host, estimatedCostUsd: cost, error: String(error?.message ?? error),
    });
  }

  let v;
  try { v = await verify({ capsule, host, result }); } catch (error) { v = { ok: false, evidence: `verifier threw: ${error?.message ?? error}` }; }
  const evidence = typeof v?.evidence === 'string' ? v.evidence.slice(0, 2000) : '';
  if (v?.ok !== true || !evidence.trim()) {
    return receipt(capsule, STATUS.UNVERIFIED, 'READBACK_FAILED', {
      host, estimatedCostUsd: cost, verification: { ok: false, evidence: evidence || 'no independent readback' },
    });
  }
  return receipt(capsule, STATUS.VERIFIED, null, { host, estimatedCostUsd: cost, verification: { ok: true, evidence } });
}
