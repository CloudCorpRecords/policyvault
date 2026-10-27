/**
 * The agent wallet executor — the only path by which value can move.
 *
 * Invariant: there is no code path from "agent proposes an action" to
 * "transport executes it" that does not pass through evaluatePolicy first.
 * The executor:
 *   1. snapshots today's executed spend (its own ledger),
 *   2. asks the policy engine for a decision,
 *   3. executes ONLY on ALLOW (or on APPROVAL_REQUIRED when a human
 *      approval is explicitly supplied with the proposal),
 *   4. appends the decision AND its outcome to the audit log — including
 *      refusals, so an agent's rejected attempts are on the record too.
 *
 * The daily-spend ledger is held in memory by this reference
 * implementation. A production deployment would persist it (or derive it
 * from the account's on-chain history) — see README "Security model".
 */

import { AgentAction, actionAmountYocto } from './types';
import { LedgerSnapshot, PolicyConfig, PolicyDecision, evaluatePolicy } from './policy';
import { AuditLog } from './audit';
import { Transport } from './transport';

export type ProposalStatus =
  | 'executed'
  | 'refused'
  | 'approval-required'
  | 'execution-failed';

export interface ProposalResult {
  status: ProposalStatus;
  decision: PolicyDecision;
  /** Sequence number of the audit entry written for this proposal. */
  auditSeq: number;
  /** Transport reference when execution happened. */
  executionRef?: string;
}

export interface AgentWalletOptions {
  accountId: string;
  policy: PolicyConfig;
  transport: Transport;
  audit: AuditLog;
  /** Clock injection for deterministic tests/demo. Defaults to real time. */
  now?: () => Date;
}

export class AgentWallet {
  private readonly spentByDay = new Map<string, bigint>();
  private readonly now: () => Date;

  constructor(private readonly opts: AgentWalletOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  get accountId(): string {
    return this.opts.accountId;
  }

  /** UTC day key, e.g. "2026-10-27". The daily cap resets on UTC midnight. */
  dayKey(at: Date = this.now()): string {
    return at.toISOString().slice(0, 10);
  }

  spentTodayYocto(at: Date = this.now()): bigint {
    return this.spentByDay.get(this.dayKey(at)) ?? 0n;
  }

  ledgerSnapshot(): LedgerSnapshot {
    return {
      dayKey: this.dayKey(),
      spentTodayYocto: this.spentTodayYocto(),
    };
  }

  async propose(
    action: AgentAction,
    opts: { actor?: string; humanApproved?: boolean } = {},
  ): Promise<ProposalResult> {
    const actor = opts.actor ?? 'agent';
    const decision = evaluatePolicy(this.opts.policy, action, this.ledgerSnapshot());

    if (decision.verdict === 'DENY') {
      const entry = this.opts.audit.append({
        actor,
        action,
        decision,
        executed: false,
        detail: 'refused by policy; nothing was signed or broadcast',
      });
      return { status: 'refused', decision, auditSeq: entry.seq };
    }

    if (decision.verdict === 'APPROVAL_REQUIRED' && !opts.humanApproved) {
      const entry = this.opts.audit.append({
        actor,
        action,
        decision,
        executed: false,
        detail: 'parked for human approval; not executed',
      });
      return { status: 'approval-required', decision, auditSeq: entry.seq };
    }

    // ALLOW, or APPROVAL_REQUIRED with an explicit human approval attached.
    const effectiveDecision: PolicyDecision =
      decision.verdict === 'APPROVAL_REQUIRED'
        ? {
            ...decision,
            reasons: [
              ...decision.reasons,
              'Human approval was supplied with this proposal; proceeding.',
            ],
          }
        : decision;

    try {
      const result = await this.opts.transport.execute(action);
      const key = this.dayKey();
      this.spentByDay.set(key, this.spentTodayYocto() + actionAmountYocto(action));
      const entry = this.opts.audit.append({
        actor,
        action,
        decision: effectiveDecision,
        executed: true,
        detail: result.ref,
      });
      return {
        status: 'executed',
        decision: effectiveDecision,
        auditSeq: entry.seq,
        executionRef: result.ref,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const entry = this.opts.audit.append({
        actor,
        action,
        decision: effectiveDecision,
        executed: false,
        detail: `execution failed: ${message}`,
      });
      return { status: 'execution-failed', decision: effectiveDecision, auditSeq: entry.seq };
    }
  }
}
