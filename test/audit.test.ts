import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { AuditLog, verifyAuditChain, AuditEntry } from '../src/audit';
import { PolicyDecision } from '../src/policy';
import { parseNearToYocto as N } from '../src/near-units';

const allow: PolicyDecision = { verdict: 'ALLOW', rules: ['ALL_RULES_PASSED'], reasons: ['ok'] };
const action = { kind: 'transfer', to: 'researcher.testnet', amountYocto: N('0.5') } as const;

function fixedClock() {
  let t = Date.parse('2026-10-27T09:00:00.000Z');
  return () => new Date((t += 60_000));
}

test('appends entries with increasing seq and linked hashes', () => {
  const log = new AuditLog(undefined, fixedClock());
  const e1 = log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'sim-tx-1' });
  const e2 = log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'sim-tx-2' });
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(e2.prevHash, e1.hash);
  assert.equal(log.headHash(), e2.hash);
});

test('verifies an untampered chain', () => {
  const log = new AuditLog(undefined, fixedClock());
  log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'a' });
  log.append({ actor: 'agent', action, decision: allow, executed: false, detail: 'b' });
  const v = log.verify();
  assert.equal(v.ok, true);
  assert.equal(v.entries, 2);
});

test('detects a tampered verdict', () => {
  const log = new AuditLog(undefined, fixedClock());
  log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'a' });
  const tampered: AuditEntry[] = log.entries().map((e) => ({ ...e, verdict: 'DENY' as const }));
  const v = verifyAuditChain(tampered);
  assert.equal(v.ok, false);
  assert.equal(v.atSeq, 1);
});

test('detects a deleted entry (chain break)', () => {
  const log = new AuditLog(undefined, fixedClock());
  log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'a' });
  log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'b' });
  log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'c' });
  const cut = log.entries().filter((e) => e.seq !== 2);
  const v = verifyAuditChain(cut);
  assert.equal(v.ok, false);
});

test('persists to JSONL and reloads with the chain intact', () => {
  const file = join(tmpdir(), `policyvault-audit-test-${process.pid}.jsonl`);
  try {
    const log = new AuditLog(file, fixedClock());
    log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'x' });
    log.append({ actor: 'agent', action, decision: allow, executed: false, detail: 'y' });
    const loaded = AuditLog.loadFromFile(file);
    assert.equal(loaded.length, 2);
    assert.equal(verifyAuditChain(loaded).ok, true);
  } finally {
    rmSync(file, { force: true });
  }
});

test('an empty chain verifies', () => {
  assert.deepEqual(verifyAuditChain([]), { ok: true, entries: 0 });
});

test('a file-backed log resumes its chain across instances (no seq reuse)', () => {
  const file = join(tmpdir(), `policyvault-audit-resume-${process.pid}.jsonl`);
  try {
    const first = new AuditLog(file, fixedClock());
    first.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'run-1' });
    const second = new AuditLog(file, fixedClock());
    const e = second.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'run-2' });
    assert.equal(e.seq, 2);
    assert.equal(second.verify().ok, true);
    assert.equal(AuditLog.loadFromFile(file).length, 2);
  } finally {
    rmSync(file, { force: true });
  }
});

test('resuming a tampered log file throws instead of extending it', () => {
  const file = join(tmpdir(), `policyvault-audit-tamper-${process.pid}.jsonl`);
  try {
    const log = new AuditLog(file, fixedClock());
    log.append({ actor: 'agent', action, decision: allow, executed: true, detail: 'x' });
    const entries = AuditLog.loadFromFile(file);
    entries[0].detail = 'forged';
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(file, JSON.stringify(entries[0]) + '\n', 'utf8');
    assert.throws(() => new AuditLog(file, fixedClock()), /fails verification/);
  } finally {
    rmSync(file, { force: true });
  }
});
