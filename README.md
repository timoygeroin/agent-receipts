# agent-receipts

**Your agent said "done". Was it?**

AI agents routinely report success for work that never happened: a file that was never written, an email that bounced, a test that was skipped, a tool call that timed out. `agent-receipts` is a tiny, zero-dependency library that makes "done" a *verified* fact instead of a sentence.

The rule is simple:

> An agent may only report **DONE** for an effect that has a **VERIFIED** receipt — and a receipt is VERIFIED only when an independent readback of the world confirms it.

## What you get

- **Capsules** — a frozen, hashed description of one intended effect (`id`, `intent`, `capability`, `sideEffect`, `maxCostUsd`). Tampering in transit is detected.
- **`runEffect()`** — runs a capsule through any adapter and a separate verifier. Returns a receipt that is `VERIFIED`, `UNVERIFIED` or `BLOCKED`:
  - no verifier → `BLOCKED` (you cannot even try without a way to check)
  - exception during execution → `UNVERIFIED / EXECUTION_AMBIGUOUS` (the effect may have happened; never treated as success)
  - adapter says "ok" but readback disagrees → `UNVERIFIED / READBACK_FAILED`
  - external side effects (send, post, pay) or any cost → require an explicit `authorize()` returning literal `true`
  - cost estimate above budget → `BLOCKED / BUDGET_EXCEEDED`
- **`ReceiptLedger`** — append-only, hash-chained log. Edits to past entries break the chain (tamper-evident, not tamper-proof).
- **`auditClaims()`** — compares the agent's final report with the receipts and flags `FALSE_DONE` and `UNDER_CLAIM`.
- **`summarize()`** — one honest status line generated from receipts, not from the model's prose.

## Quick start

```js
import { makeCapsule, runEffect, ReceiptLedger, auditClaims } from 'agent-receipts';

const capsule = makeCapsule({ id: 'write-report', intent: 'write report.txt', capability: 'fs.write' });

const receipt = await runEffect(capsule, {
  adapter: { id: 'fs', capabilities: ['fs.write'], estimate: () => 0, execute: () => writeReport() },
  verify: () => {                      // read the world back; do not trust execute()'s return value
    const ok = existsSync('report.txt') && readFileSync('report.txt', 'utf8') === expected;
    return { ok, evidence: ok ? 'report.txt matches expected bytes' : 'report.txt missing or different' };
  },
});

const ledger = new ReceiptLedger();
ledger.append(receipt);

// The agent's final message is audited before a human ever sees it:
auditClaims([{ capsuleId: 'write-report', claimed: 'DONE' }], id => ledger.latest(id));
// -> { ok: false, falseDone: 1, ... } if the readback failed
```

Run the bundled example (a "lazy" host that claims success but writes nothing, then an honest one):

```
npm run example
```

```
lazy host  : UNVERIFIED READBACK_FAILED - /tmp/.../report.txt does not exist
agent says "done" -> FALSE_DONE
honest host: VERIFIED - read back 20 bytes: "quarterly numbers v2"
agent says "done" -> HONEST
chain intact: true
```

## Tests

```
npm test        # node:test, no dependencies, Node >= 18
```

## Design notes

- Hashes detect change; they do **not** authenticate authors or prove outcomes. Proof comes only from the verifier reading the world back.
- Verifiers should be independent of the executor (different code path, ideally different credentials).
- Capsules are data, never privileged instructions. A capsule received from another agent is re-derived and re-hashed before use.
- `UNVERIFIED` is not failure. It means "nobody knows yet" — which is exactly what an honest agent should say.

## Companion: false-done benchmark

`../bench` contains a scaffold for measuring how often a model reports DONE when the execution log shows it was not. See `bench/README.md`.

## Status

v0.1.0, unpublished.

## License

Dual license, owner keeps all rights:

- **Noncommercial** use (personal, research, education, nonprofits): free under the PolyForm Noncommercial License 1.0.0.
- **Commercial** use (embedding in a product, SaaS, internal business use): requires a commercial license with a royalty. See `COMMERCIAL.md`.

This is source-available, not OSI open source.
