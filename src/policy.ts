/**
 * The policy engine. Pure and deterministic: same (policy, action, ledger)
 * in -> same decision out. No I/O, no clock of its own, no randomness.
 * Deny-by-default: an action is allowed only if it survives every rule.
 *
 * Rule precedence (first matching DENY wins; documented so behaviour is
 * predictable and testable):
 *   1. MALFORMED_AMOUNT   — amount/deposit is zero or negative
 *   2. RECIPIENT_ALLOWLIST / CONTRACT_ALLOWLIST / METHOD_ALLOWLIST
 *   3. PER_TX_CAP         — single action above the per-transaction cap
 *   4. DAILY_CAP          — action would push today's spend over the daily cap
 *   5. APPROVAL_THRESHOLD — action above the human-approval threshold
 *                           (a soft stop, not a denial: a human may approve)
 *   otherwise ALLOW.
 *
 * Note the interaction: a hard DENY always beats the approval path. An
 * agent can never "get approval" for an over-cap or non-allowlisted action.
 */

import { actionAmountYocto, actionCounterparty, AgentAction } from './types';
import { formatYoctoToNear, parseNearToYocto } from './near-units';

export interface PolicyConfig {
  /** Max value of a single action, in yoctoNEAR. */
  perTxCapYocto: bigint;
  /** Max total executed value per UTC day, in yoctoNEAR. */
  dailyCapYocto: bigint;
  /** Actions strictly above this need a human approval before executing. */
  approvalThresholdYocto: bigint;
  /** Transfer recipients the agent may pay. Exact account ids. */
  allowedRecipients: string[];
  /**
   * Contracts the agent may call, mapped to the method names it may call.
   * A method list containing "*" allows any method on that contract.
   */
  allowedContracts: Record<string, string[]>;
}

/** What the executor has already spent in the current UTC day. */
export interface LedgerSnapshot {
  dayKey: string; // "YYYY-MM-DD" (UTC)
  spentTodayYocto: bigint;
}

export type Verdict = 'ALLOW' | 'DENY' | 'APPROVAL_REQUIRED';

export interface PolicyDecision {
  verdict: Verdict;
  /** Machine-readable rule ids that produced this verdict, in precedence order. */
  rules: string[];
  /** Human-readable explanations, parallel to `rules`. */
  reasons: string[];
}

export function evaluatePolicy(
  policy: PolicyConfig,
  action: AgentAction,
  ledger: LedgerSnapshot,
): PolicyDecision {
  const amount = actionAmountYocto(action);
  const counterparty = actionCounterparty(action);
  const near = (y: bigint) => `${formatYoctoToNear(y)} NEAR`;

  // 1. Malformed amounts are denied before any other consideration.
  if (amount <= 0n) {
    return deny(['MALFORMED_AMOUNT'], [
      `Amount must be positive; got ${near(amount)}.`,
    ]);
  }

  // 2. Allowlist (deny-by-default: absence from the list is a denial).
  if (action.kind === 'transfer') {
    if (!policy.allowedRecipients.includes(action.to)) {
      return deny(['RECIPIENT_ALLOWLIST'], [
        `Recipient ${action.to} is not on the recipient allowlist.`,
      ]);
    }
  } else {
    const methods = policy.allowedContracts[action.contractId];
    if (!methods) {
      return deny(['CONTRACT_ALLOWLIST'], [
        `Contract ${action.contractId} is not on the contract allowlist.`,
      ]);
    }
    if (!methods.includes('*') && !methods.includes(action.methodName)) {
      return deny(['METHOD_ALLOWLIST'], [
        `Method ${action.methodName} on ${action.contractId} is not allowlisted (allowed: ${methods.join(', ')}).`,
      ]);
    }
  }

  // 3. Per-transaction cap.
  if (amount > policy.perTxCapYocto) {
    return deny(['PER_TX_CAP'], [
      `Amount ${near(amount)} exceeds the per-transaction cap of ${near(policy.perTxCapYocto)}. Counterparty: ${counterparty}.`,
    ]);
  }

  // 4. Daily cap (executed spend so far today + this action).
  if (ledger.spentTodayYocto + amount > policy.dailyCapYocto) {
    return deny(['DAILY_CAP'], [
      `Amount ${near(amount)} would bring today's spend to ${near(ledger.spentTodayYocto + amount)}, over the daily cap of ${near(policy.dailyCapYocto)}.`,
    ]);
  }

  // 5. Human-approval threshold (soft stop).
  if (amount > policy.approvalThresholdYocto) {
    return {
      verdict: 'APPROVAL_REQUIRED',
      rules: ['APPROVAL_THRESHOLD'],
      reasons: [
        `Amount ${near(amount)} is above the human-approval threshold of ${near(policy.approvalThresholdYocto)}. A human must approve before this executes.`,
      ],
    };
  }

  return {
    verdict: 'ALLOW',
    rules: ['ALL_RULES_PASSED'],
    reasons: [
      `Within all limits: ${near(amount)} to ${counterparty}; today's spend after this would be ${near(ledger.spentTodayYocto + amount)} of ${near(policy.dailyCapYocto)}.`,
    ],
  };
}

function deny(rules: string[], reasons: string[]): PolicyDecision {
  return { verdict: 'DENY', rules, reasons };
}

/** JSON shape for policy files; amounts are NEAR decimal strings. */
export interface PolicyFileJson {
  perTxCapNear: string;
  dailyCapNear: string;
  approvalThresholdNear: string;
  allowedRecipients: string[];
  allowedContracts: Record<string, string[]>;
}

export function policyFromJson(json: PolicyFileJson): PolicyConfig {
  const perTxCapYocto = parseNearToYocto(json.perTxCapNear);
  const dailyCapYocto = parseNearToYocto(json.dailyCapNear);
  const approvalThresholdYocto = parseNearToYocto(json.approvalThresholdNear);
  if (
    !Array.isArray(json.allowedRecipients) ||
    typeof json.allowedContracts !== 'object' ||
    json.allowedContracts === null
  ) {
    throw new Error('Policy JSON must define allowedRecipients (array) and allowedContracts (object).');
  }
  return {
    perTxCapYocto,
    dailyCapYocto,
    approvalThresholdYocto,
    allowedRecipients: [...json.allowedRecipients],
    allowedContracts: { ...json.allowedContracts },
  };
}

/** The demo policy, shared by the demo script, send.ts default, and tests. */
export function demoPolicy(): PolicyConfig {
  return policyFromJson({
    perTxCapNear: '2',
    dailyCapNear: '4',
    approvalThresholdNear: '1',
    allowedRecipients: ['researcher.testnet', 'teammate.testnet'],
    allowedContracts: { 'api-market.testnet': ['pay_for_compute'] },
  });
}
