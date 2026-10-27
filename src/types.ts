/**
 * The actions an agent can propose to its wallet. Deliberately small:
 * a plain NEAR transfer, or a function call on a contract (with deposit).
 * Anything an agent wants to do with money is one of these two shapes,
 * so the policy engine only has to reason about two shapes.
 */

export type AccountId = string;

export interface TransferAction {
  kind: 'transfer';
  /** Recipient account id. */
  to: AccountId;
  /** Amount in yoctoNEAR. */
  amountYocto: bigint;
  memo?: string;
}

export interface FunctionCallAction {
  kind: 'functionCall';
  /** Contract account id. */
  contractId: AccountId;
  methodName: string;
  /** JSON-serialisable call arguments. */
  args?: Record<string, unknown>;
  /** Attached deposit in yoctoNEAR (counts as spend, exactly like a transfer). */
  depositYocto: bigint;
  /** Gas as a decimal string (yocto of gas units). Defaults in the transport. */
  gas?: string;
}

export type AgentAction = TransferAction | FunctionCallAction;

/** How much value an action moves out of the wallet, in yoctoNEAR. */
export function actionAmountYocto(action: AgentAction): bigint {
  return action.kind === 'transfer' ? action.amountYocto : action.depositYocto;
}

/** The account on the other side of an action (recipient or contract). */
export function actionCounterparty(action: AgentAction): AccountId {
  return action.kind === 'transfer' ? action.to : action.contractId;
}

/** JSON-safe summary of an action (bigints become strings). Safe to log. */
export function summariseAction(action: AgentAction): Record<string, unknown> {
  if (action.kind === 'transfer') {
    return {
      kind: 'transfer',
      to: action.to,
      amountYocto: action.amountYocto.toString(),
      ...(action.memo ? { memo: action.memo } : {}),
    };
  }
  return {
    kind: 'functionCall',
    contractId: action.contractId,
    methodName: action.methodName,
    depositYocto: action.depositYocto.toString(),
    ...(action.args ? { args: action.args } : {}),
  };
}
