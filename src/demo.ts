/**
 * Deterministic demo — `npm run demo`.
 *
 * Runs entirely in local simulation mode: no network, no keys, no funds.
 * A fixed logical clock makes every run byte-identical, so a judge can
 * re-run it and diff the output. Steps are written as "do X — see Y".
 *
 * The policy used here (see policy.example.json):
 *   per-transaction cap 2 NEAR · daily cap 4 NEAR · approval threshold 1 NEAR
 *   transfer allowlist: researcher.testnet, teammate.testnet
 *   contract allowlist: api-market.testnet, method pay_for_compute only
 * The simulated agent wallet starts with 10 NEAR.
 */

import { AgentWallet } from './wallet';
import { AuditLog } from './audit';
import { SimulatedTransport } from './transport';
import { demoPolicy } from './policy';
import { parseNearToYocto, formatYoctoToNear } from './near-units';
import { AgentAction } from './types';

const N = (s: string) => parseNearToYocto(s);
const fmt = (y: bigint) => `${formatYoctoToNear(y)} NEAR`;

// Deterministic clock: starts 2026-10-27T09:00:00Z, +1 minute per audit entry.
function makeClock() {
  let t = Date.parse('2026-10-27T09:00:00.000Z');
  return () => {
    const d = new Date(t);
    t += 60_000;
    return d;
  };
}

async function main(): Promise<void> {
  const audit = new AuditLog(undefined, makeClock());
  const transport = new SimulatedTransport('agent.testnet', N('10'));
  const wallet = new AgentWallet({
    accountId: 'agent.testnet',
    policy: demoPolicy(),
    transport,
    audit,
    now: makeClock(),
  });

  console.log('PolicyVault demo — policy-gated agent wallet (local simulation, NEAR testnet shapes)');
  console.log('Policy: per-tx cap 2 NEAR | daily cap 4 NEAR | approval threshold 1 NEAR');
  console.log('Allowlist: transfers to researcher.testnet, teammate.testnet; calls to api-market.testnet (pay_for_compute)');
  console.log(`Wallet agent.testnet opening balance: ${fmt(transport.balanceOf('agent.testnet'))}`);
  console.log('');

  const steps: Array<{ label: string; action: AgentAction }> = [
    {
      label: 'STEP 1 — agent pays an allowlisted researcher 0.5 NEAR for a data set',
      action: { kind: 'transfer', to: 'researcher.testnet', amountYocto: N('0.5'), memo: 'dataset payment' },
    },
    {
      label: 'STEP 2 — agent tries to pay 3 NEAR (over the 2 NEAR per-transaction cap)',
      action: { kind: 'transfer', to: 'researcher.testnet', amountYocto: N('3') },
    },
    {
      label: 'STEP 3 — agent tries to pay 0.1 NEAR to a stranger (not on the allowlist)',
      action: { kind: 'transfer', to: 'stranger.testnet', amountYocto: N('0.1') },
    },
    {
      label: 'STEP 4 — agent tries to pay a teammate 1.5 NEAR (above the 1 NEAR approval threshold)',
      action: { kind: 'transfer', to: 'teammate.testnet', amountYocto: N('1.5') },
    },
    {
      label: 'STEP 5 — agent pays for compute: function call api-market.testnet.pay_for_compute with 0.2 NEAR deposit',
      action: { kind: 'functionCall', contractId: 'api-market.testnet', methodName: 'pay_for_compute', args: { job: 'embed-corpus' }, depositYocto: N('0.2') },
    },
    {
      label: 'STEP 6 — agent tries a non-allowlisted method: api-market.testnet.drain_vault',
      action: { kind: 'functionCall', contractId: 'api-market.testnet', methodName: 'drain_vault', depositYocto: N('0.1') },
    },
    {
      label: 'STEP 7 — agent pays researcher 0.9 NEAR (daily spend so far: 0.7)',
      action: { kind: 'transfer', to: 'researcher.testnet', amountYocto: N('0.9') },
    },
    {
      label: 'STEP 8 — agent pays researcher another 0.9 NEAR (daily spend so far: 1.6)',
      action: { kind: 'transfer', to: 'researcher.testnet', amountYocto: N('0.9') },
    },
    {
      label: 'STEP 9 — agent pays teammate 0.9 NEAR (daily spend so far: 2.5)',
      action: { kind: 'transfer', to: 'teammate.testnet', amountYocto: N('0.9') },
    },
    {
      label: 'STEP 10 — agent tries one more 0.9 NEAR (would take today to 4.3, over the 4 NEAR daily cap)',
      action: { kind: 'transfer', to: 'researcher.testnet', amountYocto: N('0.9') },
    },
  ];

  for (const step of steps) {
    const result = await wallet.propose(step.action);
    console.log(step.label);
    console.log(
      `  -> ${result.status.toUpperCase()} [${result.decision.rules.join(', ')}] ${result.decision.reasons.join(' ')}` +
        (result.executionRef ? ` (ref: ${result.executionRef})` : ''),
    );
  }

  console.log('');
  console.log(`Wallet balance after demo: ${fmt(transport.balanceOf('agent.testnet'))} | spent today: ${fmt(wallet.spentTodayYocto())}`);
  console.log('');
  console.log('--- AUDIT LOG (append-only, hash-chained) ---');
  for (const e of audit.entries()) {
    const a = e.action as { kind: string; to?: string; contractId?: string; methodName?: string; amountYocto?: string; depositYocto?: string };
    const what =
      a.kind === 'transfer'
        ? `transfer ${fmt(BigInt(a.amountYocto ?? '0'))} -> ${a.to}`
        : `call ${a.contractId}.${a.methodName} deposit ${fmt(BigInt(a.depositYocto ?? '0'))}`;
    console.log(
      `#${e.seq} ${e.ts} ${what} | verdict=${e.verdict} executed=${e.executed} | hash=${e.hash.slice(0, 12)}… prev=${e.prevHash.slice(0, 12)}…`,
    );
  }
  const verification = audit.verify();
  console.log(
    verification.ok
      ? `AUDIT CHAIN VERIFIED: ${verification.entries} entries, links and hashes intact.`
      : `AUDIT CHAIN BROKEN at seq ${verification.atSeq}: ${verification.problem}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
