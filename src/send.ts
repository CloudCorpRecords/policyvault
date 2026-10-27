/**
 * send.ts — propose ONE action to the policy-gated wallet.
 *
 * Usage:
 *   MODE=sim     node dist/src/send.js transfer <to> <amountNear> [--approve]
 *   MODE=sim     node dist/src/send.js call <contract> <method> <depositNear> [jsonArgs] [--approve]
 *   MODE=testnet node dist/src/send.js transfer <to> <amountNear>   (needs NEAR_* env vars)
 *
 * Exit codes: 0 executed · 2 refused by policy · 3 approval required · 1 error.
 * The audit entry for the proposal is appended to AUDIT_FILE (default
 * ./audit.log.jsonl) so refusals are on the record too.
 *
 * Policy comes from POLICY_FILE (JSON, see policy.example.json) or the
 * built-in demo policy when unset.
 */

import { readFileSync } from 'node:fs';
import { AgentWallet } from './wallet';
import { AuditLog } from './audit';
import {
  NearTestnetTransport,
  SimulatedTransport,
  Transport,
  nearTestnetConfigFromEnv,
} from './transport';
import { PolicyConfig, PolicyFileJson, demoPolicy, policyFromJson } from './policy';
import { parseNearToYocto } from './near-units';
import { AgentAction } from './types';

function loadPolicy(): PolicyConfig {
  const file = process.env.POLICY_FILE;
  if (!file) return demoPolicy();
  const json = JSON.parse(readFileSync(file, 'utf8')) as PolicyFileJson;
  return policyFromJson(json);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const approve = argv.includes('--approve');
  const args = argv.filter((a) => a !== '--approve');
  const [verb, a, b, c, d] = args;

  let action: AgentAction;
  if (verb === 'transfer' && a && b) {
    action = { kind: 'transfer', to: a, amountYocto: parseNearToYocto(b) };
  } else if (verb === 'call' && a && b && c) {
    action = {
      kind: 'functionCall',
      contractId: a,
      methodName: b,
      depositYocto: parseNearToYocto(c),
      args: d ? (JSON.parse(d) as Record<string, unknown>) : undefined,
    };
  } else {
    console.error('Usage: send.js transfer <to> <amountNear> [--approve]');
    console.error('       send.js call <contract> <method> <depositNear> [jsonArgs] [--approve]');
    process.exit(1);
  }

  const mode = process.env.MODE ?? 'sim';
  const audit = new AuditLog(process.env.AUDIT_FILE ?? './audit.log.jsonl');
  let transport: Transport;
  let accountId: string;
  if (mode === 'testnet') {
    const config = nearTestnetConfigFromEnv(process.env);
    transport = new NearTestnetTransport(config);
    accountId = config.accountId;
  } else if (mode === 'sim') {
    accountId = process.env.NEAR_ACCOUNT_ID ?? 'agent.testnet';
    transport = new SimulatedTransport(
      accountId,
      parseNearToYocto(process.env.SIM_BALANCE_NEAR ?? '10'),
    );
  } else {
    console.error(`Unknown MODE ${JSON.stringify(mode)} — expected "sim" or "testnet".`);
    process.exit(1);
  }

  const wallet = new AgentWallet({ accountId, policy: loadPolicy(), transport, audit });
  const result = await wallet.propose(action, { humanApproved: approve });
  console.log(`decision: ${result.decision.verdict} [${result.decision.rules.join(', ')}]`);
  for (const reason of result.decision.reasons) console.log(`  ${reason}`);
  console.log(`status: ${result.status}${result.executionRef ? ` (ref: ${result.executionRef})` : ''}`);
  console.log(`audit: entry #${result.auditSeq} appended`);

  process.exit(result.status === 'executed' ? 0 : result.status === 'refused' ? 2 : result.status === 'approval-required' ? 3 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
