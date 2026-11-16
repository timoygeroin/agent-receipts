import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCapsule, reviveCapsule, runEffect, ReceiptLedger, auditClaims, summarize, STATUS } from '../src/index.mjs';

const mem = () => {
  const store = new Map();
  return {
    store,
    adapter: {
      id: 'mem', capabilities: ['kv.write'], estimate: () => 0,
      execute: (c) => { const [k, v] = c.intent.split('='); store.set(k, v); return { wrote: k }; },
    },
    verify: ({ capsule }) => {
      const [k, v] = capsule.intent.split('=');
      return store.get(k) === v ? { ok: true, evidence: `read ${k}=${store.get(k)}` } : { ok: false, evidence: `read ${k}=${store.get(k)}` };
    },
  };
};

test('capsule is frozen, hashed, validated', () => {
  const c = makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write' });
  assert.ok(Object.isFrozen(c));
  assert.equal(c.digest.length, 64);
  assert.throws(() => makeCapsule({ id: 'a', intent: '', capability: 'kv.write' }), /INTENT_REQUIRED/);
  assert.throws(() => makeCapsule({ id: 'a', intent: 'x', capability: '1bad' }), /CAPABILITY_INVALID/);
  assert.throws(() => makeCapsule({ id: 'a', intent: 'x', capability: 'k', maxCostUsd: -1 }), /BUDGET_INVALID/);
});

test('tampered capsule is blocked', async () => {
  const c = { ...makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write' }), intent: 'x=2' };
  assert.equal(reviveCapsule(c), null);
  const r = await runEffect(c, mem());
  assert.equal(r.status, STATUS.BLOCKED);
  assert.equal(r.code, 'INVALID_OR_TAMPERED_CAPSULE');
});

test('successful effect with readback is VERIFIED', async () => {
  const m = mem();
  const r = await runEffect(makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write' }), m);
  assert.equal(r.status, STATUS.VERIFIED);
  assert.match(r.verification.evidence, /x=1/);
});

test('silent no-op is UNVERIFIED, not done', async () => {
  const m = mem();
  m.adapter.execute = () => ({ wrote: 'x' }); // claims success, writes nothing
  const r = await runEffect(makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write' }), m);
  assert.equal(r.status, STATUS.UNVERIFIED);
  assert.equal(r.code, 'READBACK_FAILED');
});

test('exception during execute is ambiguous, never success', async () => {
  const m = mem();
  m.adapter.execute = () => { throw new Error('timeout'); };
  const r = await runEffect(makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write' }), m);
  assert.equal(r.status, STATUS.UNVERIFIED);
  assert.equal(r.code, 'EXECUTION_AMBIGUOUS');
});

test('no verifier means blocked', async () => {
  const m = mem();
  const r = await runEffect(makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write' }), { adapter: m.adapter });
  assert.equal(r.code, 'VERIFIER_REQUIRED');
});

test('external effect needs explicit authorization', async () => {
  const m = mem();
  m.adapter.capabilities.push('email.send');
  const c = makeCapsule({ id: 'e', intent: 'x=1', capability: 'email.send', sideEffect: 'external' });
  assert.equal((await runEffect(c, m)).code, 'AUTHORIZATION_REQUIRED');
  assert.equal((await runEffect(c, { ...m, authorize: () => 'yes' })).code, 'AUTHORIZATION_REQUIRED'); // only literal true
  assert.equal((await runEffect(c, { ...m, authorize: () => true })).status, STATUS.VERIFIED);
});

test('budget is enforced', async () => {
  const m = mem();
  m.adapter.estimate = () => 3;
  const r = await runEffect(makeCapsule({ id: 'a', intent: 'x=1', capability: 'kv.write', maxCostUsd: 1 }), m);
  assert.equal(r.code, 'BUDGET_EXCEEDED');
});

test('missing capability is blocked', async () => {
  const r = await runEffect(makeCapsule({ id: 'a', intent: 'x=1', capability: 'fs.delete' }), mem());
  assert.equal(r.code, 'CAPABILITY_UNAVAILABLE');
});

test('ledger chain detects edits', () => {
  const l = new ReceiptLedger({ now: () => 't' });
  l.append({ capsuleId: 'a', status: 'VERIFIED' });
  l.append({ capsuleId: 'b', status: 'BLOCKED' });
  const e = l.entries();
  assert.deepEqual(ReceiptLedger.verifyChain(e), { ok: true, brokenAt: null });
  e[0].receipt.status = 'BLOCKED';
  assert.equal(ReceiptLedger.verifyChain(e).brokenAt, 0);
  assert.equal(l.latest('b').status, 'BLOCKED');
});

test('audit catches false "done" and under-claims', async () => {
  const m = mem();
  const l = new ReceiptLedger();
  l.append(await runEffect(makeCapsule({ id: 'ok', intent: 'a=1', capability: 'kv.write' }), m));
  m.adapter.execute = () => ({});
  l.append(await runEffect(makeCapsule({ id: 'noop', intent: 'b=1', capability: 'kv.write' }), m));
  const a = auditClaims([
    { capsuleId: 'ok', claimed: 'NOT_DONE' },
    { capsuleId: 'noop', claimed: 'DONE' },
    { capsuleId: 'ghost', claimed: 'DONE' },
  ], id => l.latest(id));
  assert.equal(a.ok, false);
  assert.equal(a.falseDone, 2);
  assert.equal(a.underClaim, 1);
  assert.equal(summarize(l.entries().map(e => e.receipt)), 'NOT DONE: 1 verified, 1 unverified, 0 blocked (of 2).');
});
