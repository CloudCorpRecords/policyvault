import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, demoPolicy, LedgerSnapshot } from '../src/policy';
import { parseNearToYocto as N } from '../src/near-units';
import { AgentAction } from '../src/types';

const policy = demoPolicy(); // perTx 2, daily 4, threshold 1; researcher/teammate; api-market.pay_for_compute
const empty: LedgerSnapshot = { dayKey: '2026-10-27', spentTodayYocto: 0n };
const spent = (near: string): LedgerSnapshot => ({ dayKey: '2026-10-27', spentTodayYocto: N(near) });

const transfer = (to: string, near: string): AgentAction => ({
  kind: 'transfer',
  to,
  amountYocto: N(near),
});
const call = (contractId: string, methodName: string, near: string): AgentAction => ({
  kind: 'functionCall',
  contractId,
  methodName,
  depositYocto: N(near),
});

test('allows a small transfer to an allowlisted recipient', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '0.5'), empty);
  assert.equal(d.verdict, 'ALLOW');
});

test('denies a zero-amount transfer as malformed', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '0'), empty);
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['MALFORMED_AMOUNT']);
});

test('denies a transfer to a non-allowlisted recipient', () => {
  const d = evaluatePolicy(policy, transfer('stranger.testnet', '0.1'), empty);
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['RECIPIENT_ALLOWLIST']);
});

test('denies a call to a non-allowlisted contract', () => {
  const d = evaluatePolicy(policy, call('unknown.testnet', 'pay', '0.1'), empty);
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['CONTRACT_ALLOWLIST']);
});

test('denies a non-allowlisted method on an allowlisted contract', () => {
  const d = evaluatePolicy(policy, call('api-market.testnet', 'drain_vault', '0.1'), empty);
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['METHOD_ALLOWLIST']);
});

test('allows an allowlisted method on an allowlisted contract', () => {
  const d = evaluatePolicy(policy, call('api-market.testnet', 'pay_for_compute', '0.2'), empty);
  assert.equal(d.verdict, 'ALLOW');
});

test('denies a transfer over the per-transaction cap', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '3'), empty);
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['PER_TX_CAP']);
});

test('allows a transfer exactly at the per-transaction cap when under the approval path', () => {
  // 2 NEAR == cap; cap is "exceeds", so not denied by PER_TX_CAP — but it is
  // above the 1 NEAR approval threshold, so it parks for a human.
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '2'), empty);
  assert.equal(d.verdict, 'APPROVAL_REQUIRED');
});

test('allows an amount exactly at the approval threshold', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '1'), empty);
  assert.equal(d.verdict, 'ALLOW');
});

test('requires approval above the threshold when within caps', () => {
  const d = evaluatePolicy(policy, transfer('teammate.testnet', '1.5'), empty);
  assert.equal(d.verdict, 'APPROVAL_REQUIRED');
  assert.deepEqual(d.rules, ['APPROVAL_THRESHOLD']);
});

test('hard deny beats the approval path (over cap AND above threshold -> DENY)', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '3'), empty);
  assert.equal(d.verdict, 'DENY');
});

test('denies when the daily cap would be exceeded', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '0.9'), spent('3.4'));
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['DAILY_CAP']);
});

test('allows when the daily cap is reached exactly', () => {
  const d = evaluatePolicy(policy, transfer('researcher.testnet', '0.6'), spent('3.4'));
  assert.equal(d.verdict, 'ALLOW'); // 3.4 + 0.6 == 4.0, not over
});

test('function-call deposits count toward the caps like transfers', () => {
  const d = evaluatePolicy(policy, call('api-market.testnet', 'pay_for_compute', '2.5'), empty);
  assert.equal(d.verdict, 'DENY');
  assert.deepEqual(d.rules, ['PER_TX_CAP']);
});
