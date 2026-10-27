import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNearToYocto, formatYoctoToNear } from '../src/near-units';
import { nearTestnetConfigFromEnv, NEAR_TESTNET_NOT_CONFIGURED } from '../src/transport';
import { policyFromJson } from '../src/policy';

test('parseNearToYocto handles whole and fractional NEAR exactly', () => {
  assert.equal(parseNearToYocto('1'), 10n ** 24n);
  assert.equal(parseNearToYocto('1.5'), 15n * 10n ** 23n);
  assert.equal(parseNearToYocto('0.000000000000000000000001'), 1n);
  assert.equal(parseNearToYocto(' 2.25 '), 225n * 10n ** 22n);
});

test('parseNearToYocto rejects junk', () => {
  for (const bad of ['', 'abc', '1.2.3', '-1', '1e3', '0.0000000000000000000000001']) {
    assert.throws(() => parseNearToYocto(bad), /Invalid NEAR amount|more than 24 decimal/);
  }
});

test('formatYoctoToNear round-trips and trims zeros', () => {
  assert.equal(formatYoctoToNear(10n ** 24n), '1');
  assert.equal(formatYoctoToNear(15n * 10n ** 23n), '1.5');
  assert.equal(formatYoctoToNear(1n), '0.000000000000000000000001');
  assert.equal(formatYoctoToNear(0n), '0');
  assert.equal(formatYoctoToNear(parseNearToYocto('3.4')), '3.4');
});

test('testnet config refuses to build without env credentials', () => {
  assert.throws(() => nearTestnetConfigFromEnv({}), new RegExp(NEAR_TESTNET_NOT_CONFIGURED.split(':')[0]));
  assert.throws(
    () => nearTestnetConfigFromEnv({ NEAR_ACCOUNT_ID: 'a.testnet' }),
    /NEAR_TESTNET_NOT_CONFIGURED/,
  );
});

test('testnet config reads account, key, and node URL from env', () => {
  const cfg = nearTestnetConfigFromEnv({
    NEAR_ACCOUNT_ID: 'agent.testnet',
    NEAR_PRIVATE_KEY: 'ed25519:placeholder-not-a-real-key',
    NEAR_NODE_URL: 'https://rpc.testnet.near.org',
  });
  assert.equal(cfg.accountId, 'agent.testnet');
  assert.equal(cfg.networkId, 'testnet');
  assert.equal(cfg.nodeUrl, 'https://rpc.testnet.near.org');
});

test('policyFromJson converts NEAR strings to yocto caps', () => {
  const p = policyFromJson({
    perTxCapNear: '2',
    dailyCapNear: '4',
    approvalThresholdNear: '1',
    allowedRecipients: ['a.testnet'],
    allowedContracts: {},
  });
  assert.equal(p.perTxCapYocto, 2n * 10n ** 24n);
  assert.equal(p.dailyCapYocto, 4n * 10n ** 24n);
  assert.equal(p.approvalThresholdYocto, 10n ** 24n);
});
