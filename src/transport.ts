/**
 * Transports move value. The executor decides WHETHER an action may run;
 * a transport only knows HOW to run one. Two implementations:
 *
 *  - SimulatedTransport: a deterministic in-memory ledger. No network, no
 *    keys. This is what the demo and the tests use, so anyone can re-run
 *    the exact same steps and see the exact same decisions.
 *
 *  - NearTestnetTransport: real NEAR testnet via near-api-js. Transfers use
 *    the account's `sendMoney`; function calls use `functionCall` with an
 *    attached deposit. Config comes from environment variables ONLY —
 *    no key material is ever read from the repository.
 */

import { AgentAction, actionAmountYocto } from './types';

export interface ExecutionResult {
  /** Transaction hash on testnet, or a simulation reference locally. */
  ref: string;
  detail: string;
}

export interface Transport {
  readonly kind: string;
  execute(action: AgentAction): Promise<ExecutionResult>;
}

/* ------------------------------------------------------------------ */
/* Simulated transport                                                 */
/* ------------------------------------------------------------------ */

export class SimulatedTransport implements Transport {
  readonly kind = 'simulated';
  private readonly balances = new Map<string, bigint>();
  private counter = 0;

  constructor(
    readonly walletAccountId: string,
    openingBalanceYocto: bigint,
  ) {
    this.balances.set(walletAccountId, openingBalanceYocto);
  }

  balanceOf(accountId: string): bigint {
    return this.balances.get(accountId) ?? 0n;
  }

  async execute(action: AgentAction): Promise<ExecutionResult> {
    const amount = actionAmountYocto(action);
    const balance = this.balanceOf(this.walletAccountId);
    if (amount > balance) {
      throw new Error(
        `INSUFFICIENT_BALANCE: simulated wallet ${this.walletAccountId} holds ${balance} yocto, action needs ${amount} yocto.`,
      );
    }
    this.balances.set(this.walletAccountId, balance - amount);
    if (action.kind === 'transfer') {
      this.balances.set(action.to, this.balanceOf(action.to) + amount);
    }
    // Function calls: the deposit leaves the wallet (to the contract);
    // its internal accounting is the contract's business.
    this.counter += 1;
    return {
      ref: `sim-tx-${this.counter}`,
      detail: `simulated execution #${this.counter} from ${this.walletAccountId}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* NEAR testnet transport (near-api-js)                                */
/* ------------------------------------------------------------------ */

export interface NearTestnetConfig {
  accountId: string;
  /** ed25519 private key string, from the NEAR_PRIVATE_KEY env var only. */
  privateKey: string;
  nodeUrl: string;
  networkId: 'testnet';
}

export const NEAR_TESTNET_NOT_CONFIGURED =
  'NEAR_TESTNET_NOT_CONFIGURED: testnet mode requires NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY environment variables (a testnet account you created in a wallet and funded from the testnet faucet). No keys are read from files.';

export function nearTestnetConfigFromEnv(env: NodeJS.ProcessEnv): NearTestnetConfig {
  const accountId = env.NEAR_ACCOUNT_ID;
  const privateKey = env.NEAR_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error(NEAR_TESTNET_NOT_CONFIGURED);
  }
  return {
    accountId,
    privateKey,
    nodeUrl: env.NEAR_NODE_URL ?? 'https://rpc.testnet.near.org',
    networkId: 'testnet',
  };
}

const DEFAULT_GAS = '30000000000000'; // 30 Tgas

export class NearTestnetTransport implements Transport {
  readonly kind = 'near-testnet';

  constructor(private readonly config: NearTestnetConfig) {}

  async execute(action: AgentAction): Promise<ExecutionResult> {
    // Lazy import so simulation mode and the unit tests never load the chain SDK.
    const { connect, keyStores, KeyPair } = await import('near-api-js');
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(
      this.config.networkId,
      this.config.accountId,
      KeyPair.fromString(this.config.privateKey as never),
    );
    const near = await connect({
      networkId: this.config.networkId,
      keyStore,
      nodeUrl: this.config.nodeUrl,
    });
    const account = await near.account(this.config.accountId);

    if (action.kind === 'transfer') {
      const res = await account.sendMoney(action.to, action.amountYocto);
      return {
        ref: res.transaction.hash,
        detail: `testnet transfer from ${this.config.accountId} to ${action.to}`,
      };
    }
    const res = await account.functionCall({
      contractId: action.contractId,
      methodName: action.methodName,
      args: action.args ?? {},
      gas: BigInt(action.gas ?? DEFAULT_GAS),
      attachedDeposit: action.depositYocto,
    });
    return {
      ref: res.transaction.hash,
      detail: `testnet function call ${action.contractId}.${action.methodName} from ${this.config.accountId}`,
    };
  }
}
