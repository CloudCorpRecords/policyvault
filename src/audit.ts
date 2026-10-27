/**
 * Append-only audit log with a SHA-256 hash chain.
 *
 * Every policy decision the wallet makes — allowed, refused, or parked for
 * human approval — is appended as one JSON line. Each entry stores the hash
 * of the previous entry, so editing, deleting, or reordering any historical
 * entry breaks the chain and is detected by `verifyAuditChain`.
 *
 * Tamper-EVIDENT, not tamper-proof: an attacker who can rewrite the whole
 * file can recompute the whole chain. The chain proves the log you are
 * reading is the log that was written, as long as you trust (or pin) the
 * head hash. That limit is stated, not hidden.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { AgentAction, summariseAction } from './types';
import { PolicyDecision } from './policy';

export interface AuditEntry {
  seq: number;
  /** ISO-8601 timestamp from the injected clock. */
  ts: string;
  actor: string;
  action: Record<string, unknown>;
  verdict: PolicyDecision['verdict'];
  rules: string[];
  reasons: string[];
  /** Whether value actually moved (false for refusals and unapproved actions). */
  executed: boolean;
  /** Transport reference (tx hash / simulation id) or an explanation. */
  detail: string;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

function canonical(entry: Omit<AuditEntry, 'hash'>): string {
  // Stable serialisation: fixed key order, as constructed below.
  return JSON.stringify({
    seq: entry.seq,
    ts: entry.ts,
    actor: entry.actor,
    action: entry.action,
    verdict: entry.verdict,
    rules: entry.rules,
    reasons: entry.reasons,
    executed: entry.executed,
    detail: entry.detail,
    prevHash: entry.prevHash,
  });
}

export function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(entry), 'utf8').digest('hex');
}

export interface AuditVerification {
  ok: boolean;
  entries: number;
  problem?: string;
  atSeq?: number;
}

/** Verify sequence numbers, prev-hash links, and entry hashes. */
export function verifyAuditChain(entries: AuditEntry[]): AuditVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i + 1) {
      return { ok: false, entries: entries.length, atSeq: e.seq, problem: `Sequence gap: expected seq ${i + 1}, found ${e.seq}.` };
    }
    if (e.prevHash !== prevHash) {
      return { ok: false, entries: entries.length, atSeq: e.seq, problem: `Broken link at seq ${e.seq}: prevHash does not match the previous entry's hash.` };
    }
    const { hash, ...rest } = e;
    if (hashEntry(rest) !== hash) {
      return { ok: false, entries: entries.length, atSeq: e.seq, problem: `Hash mismatch at seq ${e.seq}: entry content was modified after it was written.` };
    }
    prevHash = e.hash;
  }
  return { ok: true, entries: entries.length };
}

export class AuditLog {
  private readonly log: AuditEntry[] = [];
  private readonly now: () => Date;

  /**
   * @param filePath  If given, every entry is also appended to this JSONL file.
   *                  If the file already holds entries, the chain RESUMES from
   *                  them (sequence numbers and hash links continue), so a
   *                  long-lived log stays one verifiable chain across runs.
   * @param now       Clock injection (tests and the demo use a deterministic clock).
   */
  constructor(
    private readonly filePath?: string,
    now: () => Date = () => new Date(),
  ) {
    this.now = now;
    if (filePath && existsSync(filePath)) {
      const existing = AuditLog.loadFromFile(filePath);
      const check = verifyAuditChain(existing);
      if (!check.ok) {
        throw new Error(`Existing audit log ${filePath} fails verification: ${check.problem}`);
      }
      this.log.push(...existing);
    }
  }

  append(input: {
    actor: string;
    action: AgentAction;
    decision: PolicyDecision;
    executed: boolean;
    detail: string;
  }): AuditEntry {
    const prev = this.log[this.log.length - 1];
    const base: Omit<AuditEntry, 'hash'> = {
      seq: this.log.length + 1,
      ts: this.now().toISOString(),
      actor: input.actor,
      action: summariseAction(input.action),
      verdict: input.decision.verdict,
      rules: [...input.decision.rules],
      reasons: [...input.decision.reasons],
      executed: input.executed,
      detail: input.detail,
      prevHash: prev ? prev.hash : GENESIS_HASH,
    };
    const entry: AuditEntry = { ...base, hash: hashEntry(base) };
    this.log.push(entry);
    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    }
    return entry;
  }

  entries(): readonly AuditEntry[] {
    return this.log;
  }

  headHash(): string {
    const last = this.log[this.log.length - 1];
    return last ? last.hash : GENESIS_HASH;
  }

  verify(): AuditVerification {
    return verifyAuditChain([...this.log]);
  }

  /** Load a JSONL audit file written by AuditLog. */
  static loadFromFile(filePath: string): AuditEntry[] {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw === '') return [];
    return raw.split('\n').map((line) => JSON.parse(line) as AuditEntry);
  }
}
