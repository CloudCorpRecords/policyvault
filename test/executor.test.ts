import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentWallet } from '../src/wallet';
import { AuditLog } from '../src/audit';
import { SimulatedTransport } from '../src/transport';
import { demoPolicy } from '../src/policy';
import { parseNearToYocto as N, formatYoctoToNear } from '../src/near-units';
import { AgentAction } from '../src/types';

function makeWallet(startHour = 9) {
  let t = Date.parse(`2026-10-27T${String(startHour).padStart(2, '0')}:00:00.000Z`);
  const now = () => new Date(t);
  const audit = new AuditLog(undefined, now);
  const transport = new SimulatedTransport('agent.testnet', N('10'));
  const wallet = new AgentWallet({
    accountId: 'agent.testnet',
    policy: demoPolicy(),
    transport,
    audit,
    now,
  });
  return { wallet, audit, transport, advance: (ms: number) => { t += ms; } };
}

const transfer = (to: string, near: string): AgentAction => ({
  kind: 'transfer',
  to,
  amountYocto: N(near),
});

test('an allowed transfer executes, moves simulated balance, and is audited', async () => {
  const { wallet, audit, transport } = makeWallet();
  const r = await wallet.propose(transfer('researcher.testnet', '0.5'));
  assert.equal(r.status, 'executed');
  assert.equal(formatYoctoToNear(transport.balanceOf('agent.testnet')), '9.5');
  assert.equal(formatYoctoToNear(transport.balanceOf('researcher.testnet')), '0.5');
  assert.equal(formatYoctoToNear(wallet.spentTodayYocto()), '0.5');
  const entries = audit.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].verdict, 'ALLOW');
  assert.equal(entries[0].executed, true);
  assert.equal(audit.verify().ok, true);
});

test('a refused transfer does not execute and does not count toward daily spend', async () => {
  const { wallet, transport } = makeWallet();
  const r = await wallet.propose(transfer('researcher.testnet', '3'));
  assert.equal(r.status, 'refused');
  assert.equal(formatYoctoToNear(transport.balanceOf('agent.testnet')), '10');
  assert.equal(formatYoctoToNear(wallet.spentTodayYocto()), '0');
});

test('an above-threshold action parks for approval and does not execute', async () => {
  const { wallet, transport } = makeWallet();
  const r = await wallet.propose(transfer('teammate.testnet', '1.5'));
  assert.equal(r.status, 'approval-required');
  assert.equal(formatYoctoToNear(transport.balanceOf('teammate.testnet')), '0');
});

test('an above-threshold action executes when a human approval is attached', async () => {
  const { wallet, transport, audit } = makeWallet();
  const r = await wallet.propose(transfer('teammate.testnet', '1.5'), { humanApproved: true });
  assert.equal(r.status, 'executed');
  assert.equal(formatYoctoToNear(transport.balanceOf('teammate.testnet')), '1.5');
  assert.match(audit.entries()[0].reasons.join(' '), /Human approval/);
});

test('a human approval cannot rescue a hard-denied action', async () => {
  const { wallet } = makeWallet();
  const r = await wallet.propose(transfer('stranger.testnet', '0.1'), { humanApproved: true });
  assert.equal(r.status, 'refused');
});

test('an allowlisted function call executes in simulation', async () => {
  const { wallet, transport } = makeWallet();
  const r = await wallet.propose({
    kind: 'functionCall',
    contractId: 'api-market.testnet',
    methodName: 'pay_for_compute',
    depositYocto: N('0.2'),
  });
  assert.equal(r.status, 'executed');
  assert.equal(formatYoctoToNear(transport.balanceOf('agent.testnet')), '9.8');
});

test('the daily cap is enforced across a sequence of proposals', async () => {
  const { wallet } = makeWallet();
  assert.equal((await wallet.propose(transfer('researcher.testnet', '0.9'))).status, 'executed');
  assert.equal((await wallet.propose(transfer('researcher.testnet', '0.9'))).status, 'executed');
  assert.equal((await wallet.propose(transfer('researcher.testnet', '0.9'))).status, 'executed');
  assert.equal((await wallet.propose(transfer('researcher.testnet', '0.9'))).status, 'executed'); // 3.6 total
  const r = await wallet.propose(transfer('researcher.testnet', '0.9')); // would be 4.5 > 4
  assert.equal(r.status, 'refused');
  assert.deepEqual(r.decision.rules, ['DAILY_CAP']);
});

test('daily spend resets on the next UTC day', async () => {
  const { wallet, advance } = makeWallet(23);
  assert.equal((await wallet.propose(transfer('researcher.testnet', '0.9'))).status, 'executed');
  advance(2 * 60 * 60 * 1000); // 2026-10-28T01:00Z
  assert.equal(formatYoctoToNear(wallet.spentTodayYocto()), '0');
  assert.equal((await wallet.propose(transfer('researcher.testnet', '0.9'))).status, 'executed');
});

test('every proposal — allowed, refused, parked — lands in the audit log', async () => {
  const { wallet, audit } = makeWallet();
  await wallet.propose(transfer('researcher.testnet', '0.5'));
  await wallet.propose(transfer('researcher.testnet', '3'));
  await wallet.propose(transfer('teammate.testnet', '1.5'));
  assert.equal(audit.entries().length, 3);
  assert.deepEqual(
    audit.entries().map((e) => e.verdict),
    ['ALLOW', 'DENY', 'APPROVAL_REQUIRED'],
  );
  assert.equal(audit.verify().ok, true);
});
