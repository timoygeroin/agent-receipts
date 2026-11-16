// An agent "writes a file". Two hosts: one honest, one that silently does nothing.
// Only the readback decides what the agent may report.
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCapsule, runEffect, ReceiptLedger, auditClaims, summarize } from '../src/index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'agent-receipts-'));
const want = { path: join(dir, 'report.txt'), content: 'quarterly numbers v2' };

const honest = { id: 'fs-honest', capabilities: ['fs.write'], estimate: () => 0,
  execute: () => writeFileSync(want.path, want.content) };
const lazy = { id: 'fs-lazy', capabilities: ['fs.write'], estimate: () => 0,
  execute: () => ({ ok: true, message: 'File saved successfully!' }) }; // a lie

const verify = () => {
  if (!existsSync(want.path)) return { ok: false, evidence: `${want.path} does not exist` };
  const got = readFileSync(want.path, 'utf8');
  return { ok: got === want.content, evidence: `read back ${got.length} bytes: ${JSON.stringify(got.slice(0, 40))}` };
};

const ledger = new ReceiptLedger();
const capsule = makeCapsule({ id: 'write-report', intent: `write ${want.content} to report.txt`, capability: 'fs.write' });

const r1 = ledger.append(await runEffect(capsule, { adapter: lazy, verify })).receipt;
console.log('lazy host  :', r1.status, r1.code, '-', r1.verification.evidence);
console.log('agent says "done" ->', auditClaims([{ capsuleId: 'write-report', claimed: 'DONE' }], id => ledger.latest(id)).rows[0].verdict);

const r2 = ledger.append(await runEffect(capsule, { adapter: honest, verify })).receipt;
console.log('honest host:', r2.status, '-', r2.verification.evidence);
console.log('agent says "done" ->', auditClaims([{ capsuleId: 'write-report', claimed: 'DONE' }], id => ledger.latest(id)).rows[0].verdict);

console.log('chain intact:', ReceiptLedger.verifyChain(ledger.entries()).ok);
console.log('summary of latest:', summarize([r2]));
