# PolicyVault — a policy-gated agent wallet for NEAR

**The problem.** The agent economy needs AI agents that can actually spend:
pay for data, compute, APIs, and other agents. But handing an autonomous
agent a wallet key today means handing it *everything* — one prompt
injection, one bad decision, and the wallet is empty. Humans don't give a
new employee an unlimited company card; they give them a card with a limit,
a list of approved vendors, and a manager who approves big purchases.

**The product.** PolicyVault is that card, for an agent on NEAR. An AI agent
holds a NEAR wallet it can spend from, but it never touches value directly:
every proposed action is routed through a **deterministic policy engine**
before anything is signed or broadcast.

- **Per-transaction cap** — no single action may exceed it.
- **Daily cap** — total executed spend per UTC day may not exceed it.
- **Allowlist** — transfers only to named recipients; function calls only to
  named contracts and named methods. Deny-by-default.
- **Human-approval threshold** — above it, the agent stops and a human must
  approve that specific action. Approval can never rescue a hard denial.
- **Audit log** — every decision (allowed, refused, parked for approval) is
  appended to a hash-chained JSONL log with its rule-based reason, so an
  agent's *rejected attempts* are on the record too, and tampering with
  history breaks the chain.

**Tracks (NEAR HACKATHON):** primary `agents` (Agent Economy — an agent that
spends, under control) and `security` (AI Security & Defense — spending
limits, a policy engine, and a sandboxed wallet are that track's own words).

## Quickstart

Requires Node.js ≥ 20. No network, keys, or funds are needed for the demo
or the tests.

```bash
npm install
npm test        # 37 unit tests: policy engine, audit chain, executor, config
npm run demo    # the deterministic 10-step demo below
```

## Demo — do X, see Y

`npm run demo` runs a simulated agent wallet (`agent.testnet`, 10 NEAR
opening balance) under this policy: per-transaction cap **2 NEAR**, daily
cap **4 NEAR**, approval threshold **1 NEAR**, transfer allowlist
`researcher.testnet` + `teammate.testnet`, contract allowlist
`api-market.testnet` with method `pay_for_compute` only. Output is
byte-identical on every run (fixed logical clock):

```text
PolicyVault demo — policy-gated agent wallet (local simulation, NEAR testnet shapes)
Policy: per-tx cap 2 NEAR | daily cap 4 NEAR | approval threshold 1 NEAR
Allowlist: transfers to researcher.testnet, teammate.testnet; calls to api-market.testnet (pay_for_compute)
Wallet agent.testnet opening balance: 10 NEAR

STEP 1 — agent pays an allowlisted researcher 0.5 NEAR for a data set
  -> EXECUTED [ALL_RULES_PASSED] Within all limits: 0.5 NEAR to researcher.testnet; today's spend after this would be 0.5 NEAR of 4 NEAR. (ref: sim-tx-1)
STEP 2 — agent tries to pay 3 NEAR (over the 2 NEAR per-transaction cap)
  -> REFUSED [PER_TX_CAP] Amount 3 NEAR exceeds the per-transaction cap of 2 NEAR. Counterparty: researcher.testnet.
STEP 3 — agent tries to pay 0.1 NEAR to a stranger (not on the allowlist)
  -> REFUSED [RECIPIENT_ALLOWLIST] Recipient stranger.testnet is not on the recipient allowlist.
STEP 4 — agent tries to pay a teammate 1.5 NEAR (above the 1 NEAR approval threshold)
  -> APPROVAL-REQUIRED [APPROVAL_THRESHOLD] Amount 1.5 NEAR is above the human-approval threshold of 1 NEAR. A human must approve before this executes.
STEP 5 — agent pays for compute: function call api-market.testnet.pay_for_compute with 0.2 NEAR deposit
  -> EXECUTED [ALL_RULES_PASSED] Within all limits: 0.2 NEAR to api-market.testnet; today's spend after this would be 0.7 NEAR of 4 NEAR. (ref: sim-tx-2)
STEP 6 — agent tries a non-allowlisted method: api-market.testnet.drain_vault
  -> REFUSED [METHOD_ALLOWLIST] Method drain_vault on api-market.testnet is not allowlisted (allowed: pay_for_compute).
STEP 7 — agent pays researcher 0.9 NEAR (daily spend so far: 0.7)
  -> EXECUTED [ALL_RULES_PASSED] Within all limits: 0.9 NEAR to researcher.testnet; today's spend after this would be 1.6 NEAR of 4 NEAR. (ref: sim-tx-3)
STEP 8 — agent pays researcher another 0.9 NEAR (daily spend so far: 1.6)
  -> EXECUTED [ALL_RULES_PASSED] Within all limits: 0.9 NEAR to researcher.testnet; today's spend after this would be 2.5 NEAR of 4 NEAR. (ref: sim-tx-4)
STEP 9 — agent pays teammate 0.9 NEAR (daily spend so far: 2.5)
  -> EXECUTED [ALL_RULES_PASSED] Within all limits: 0.9 NEAR to teammate.testnet; today's spend after this would be 3.4 NEAR of 4 NEAR. (ref: sim-tx-5)
STEP 10 — agent tries one more 0.9 NEAR (would take today to 4.3, over the 4 NEAR daily cap)
  -> REFUSED [DAILY_CAP] Amount 0.9 NEAR would bring today's spend to 4.3 NEAR, over the daily cap of 4 NEAR.

Wallet balance after demo: 6.6 NEAR | spent today: 3.4 NEAR

--- AUDIT LOG (append-only, hash-chained) ---
#1 2026-10-27T09:00:00.000Z transfer 0.5 NEAR -> researcher.testnet | verdict=ALLOW executed=true | hash=274578cc25b3… prev=000000000000…
#2 2026-10-27T09:01:00.000Z transfer 3 NEAR -> researcher.testnet | verdict=DENY executed=false | hash=d11bbe659cbb… prev=274578cc25b3…
#3 2026-10-27T09:02:00.000Z transfer 0.1 NEAR -> stranger.testnet | verdict=DENY executed=false | hash=e09344f3b5fe… prev=d11bbe659cbb…
#4 2026-10-27T09:03:00.000Z transfer 1.5 NEAR -> teammate.testnet | verdict=APPROVAL_REQUIRED executed=false | hash=3346844be78f… prev=e09344f3b5fe…
#5 2026-10-27T09:04:00.000Z call api-market.testnet.pay_for_compute deposit 0.2 NEAR | verdict=ALLOW executed=true | hash=01d5b7d93fe1… prev=3346844be78f…
#6 2026-10-27T09:05:00.000Z call api-market.testnet.drain_vault deposit 0.1 NEAR | verdict=DENY executed=false | hash=0c2115879ce6… prev=01d5b7d93fe1…
#7 2026-10-27T09:06:00.000Z transfer 0.9 NEAR -> researcher.testnet | verdict=ALLOW executed=true | hash=c84dab8fb884… prev=0c2115879ce6…
#8 2026-10-27T09:07:00.000Z transfer 0.9 NEAR -> researcher.testnet | verdict=ALLOW executed=true | hash=501aa4f0381c… prev=c84dab8fb884…
#9 2026-10-27T09:08:00.000Z transfer 0.9 NEAR -> teammate.testnet | verdict=ALLOW executed=true | hash=30735c621ae5… prev=501aa4f0381c…
#10 2026-10-27T09:09:00.000Z transfer 0.9 NEAR -> researcher.testnet | verdict=DENY executed=false | hash=4bbfab0f4a45… prev=30735c621ae5…
AUDIT CHAIN VERIFIED: 10 entries, links and hashes intact.
```

## Propose a single action: `send.ts`

```bash
# simulation mode (default) — same policy gate, one action, audit appended
npm run send -- transfer researcher.testnet 0.5        # executed, exit 0
npm run send -- transfer researcher.testnet 5           # REFUSED (per-tx cap), exit 2
npm run send -- transfer teammate.testnet 1.5           # APPROVAL-REQUIRED, exit 3
npm run send -- transfer teammate.testnet 1.5 --approve # executed with human approval, exit 0
npm run send -- call api-market.testnet pay_for_compute 0.2 '{"job":"embed"}'
```

Exit codes: `0` executed · `2` refused by policy · `3` approval required ·
`1` error. Policy comes from `POLICY_FILE` (JSON with NEAR decimal strings,
see `policy.example.json`) or the built-in demo policy. The audit entry for
every proposal — including refusals — is appended to `AUDIT_FILE`
(default `./audit.log.jsonl`), and the chain resumes across runs.

## Testnet mode (real NEAR testnet, via near-api-js)

The product lives on **testnet**; no real funds are involved anywhere.

1. **You** (the human) create a testnet account in any NEAR wallet
   (e.g. MyNearWallet / wallet.near.org testnet flow) and fund it from the
   standard testnet faucet. Account creation is deliberately a human step —
   this software never creates accounts or generates keys.
2. Put the credentials in environment variables (never in the repo):

   ```bash
   export MODE=testnet
   export NEAR_ACCOUNT_ID=your-agent.testnet
   export NEAR_PRIVATE_KEY=ed25519:...        # from your wallet's key export
   export NEAR_NODE_URL=https://rpc.testnet.near.org   # default
   ```

3. `npm run send -- transfer researcher.testnet 0.1` — the same policy
   gate runs first; only an ALLOW (or an approved above-threshold action)
   is signed and broadcast, via near-api-js `sendMoney` / `functionCall`.

Key hygiene that NEAR makes possible and this design assumes: prefer a
**function-call access key** scoped to the contracts and methods your
policy allows, over a full-access key, for the agent's day-to-day signing.
The policy engine is then defense-in-depth on top of a key that is itself
least-privilege at the protocol level. Plain transfers require a
full-access key in NEAR's model; if your agent only pays via contract
calls, a function-call key suffices.

**Honest status of this path:** the testnet transport is implemented
against near-api-js 5.1.1 and fully type-checked, and its configuration
guards are unit-tested, but it has **not** been exercised against the live
testnet in this build because no testnet account was created (by design —
that is the human's step). The simulation path is the verified one.

## Architecture

```text
agent ──propose(action)──▶ AgentWallet (executor) ──▶ evaluatePolicy (pure)
                                │                            │
                                │                   ALLOW / DENY / APPROVAL_REQUIRED
                                ▼                            │
                        Transport.execute() ◀── only on ALLOW (or approved)
                                │
                ┌───────────────┴───────────────┐
        SimulatedTransport              NearTestnetTransport
        (in-memory ledger,              (near-api-js: sendMoney /
         deterministic)                  functionCall on testnet)
                                │
        every outcome ──▶ AuditLog (append-only JSONL, SHA-256 hash chain)
```

- `src/policy.ts` — the policy engine. Pure, deterministic, deny-by-default.
  Rule precedence (first DENY wins): `MALFORMED_AMOUNT` → allowlists
  (`RECIPIENT` / `CONTRACT` / `METHOD`) → `PER_TX_CAP` → `DAILY_CAP` →
  `APPROVAL_THRESHOLD` (soft stop) → `ALLOW`. A hard DENY always beats the
  approval path. Function-call deposits count as spend exactly like
  transfers.
- `src/wallet.ts` — the executor. Owns the daily-spend ledger and is the
  *only* path from a proposal to a transport. There is no way to reach the
  transport without a policy decision, and refusals are audited too.
- `src/transport.ts` — the two transports behind one interface.
- `src/audit.ts` — hash-chained audit log (`seq`, timestamp, action,
  verdict, rules, reasons, executed flag, `prevHash`/`hash`). Verification
  detects edited, deleted, or reordered entries. A file-backed log resumes
  its chain across processes and refuses to extend a tampered file.
- `src/near-units.ts` — exact NEAR ⇄ yoctoNEAR conversion with string math
  only. No floats ever touch money.
- `src/demo.ts`, `src/send.ts` — the demo and the single-action CLI.

## NEAR features used (named, as requested)

- **near-api-js** (v5.1.1) — account connection, signing, broadcast.
- **NEAR transfers** (`Account.sendMoney`) and **function calls**
  (`Account.functionCall`) with **attached deposits and gas** — the two
  action shapes the policy engine reasons about.
- **yoctoNEAR accounting** (1 NEAR = 10²⁴ yocto) with exact bigint/string
  math throughout.
- **NEAR testnet + public RPC** (`https://rpc.testnet.near.org`) as the
  live network; named testnet accounts (`*.testnet`).
- **Function-call access keys** — the least-privilege key model the
  security design is built around (recommended configuration; see above).

Roadmap, *not* used yet and not claimed: NEAR **Intents** for cross-chain
settlement of agent payments, **Chain Signatures** for agent accounts that
can hold addresses on other chains, and an on-chain policy contract so the
caps hold even against a compromised host process.

## Security model — and its honest limits

What PolicyVault guarantees, inside its own process:

- No value moves without a policy decision; the decision function is pure
  and fully unit-tested, including boundary cases (exactly-at-cap is
  allowed, exactly-at-threshold needs no approval, deny beats approval).
- Every decision and its reason is written to a tamper-evident log,
  including the attempts that were refused.

What it does **not** guarantee — stated plainly:

- **The policy engine is application-layer.** Code running in the same
  process (or an attacker who compromises the host) can call the transport
  or the key directly. The protocol-level backstop is NEAR's key model:
  scope the agent's key with function-call access keys, and hold real
  value in a separate account the agent cannot touch. An on-chain policy
  contract is the stronger endgame (roadmap).
- **The audit chain is tamper-evident, not tamper-proof.** Rewriting the
  whole file and recomputing the chain defeats it; pin or publish the head
  hash externally if you need stronger evidence.
- **The daily-spend ledger is in-memory** in this reference build, so a
  process restart resets today's total. A production deployment must
  persist it (or derive it from the account's on-chain history). The
  per-transaction cap and allowlists do not depend on the ledger and hold
  regardless.
- **Simulation is not the chain.** The simulated transport models balances
  and deposits only — not gas fees, storage staking, or refunds. Testnet
  behaviour is the ground truth for those.
- There is **no smart contract** in this build. The rules do not require
  one; the policy engine + NEAR's access-key model carry the design.

## File map

```text
src/policy.ts       policy engine (pure) + policy file parsing + demo policy
src/wallet.ts       executor: proposal -> decision -> transport -> audit
src/transport.ts    SimulatedTransport + NearTestnetTransport (near-api-js)
src/audit.ts        hash-chained append-only audit log + verifier
src/types.ts        the two action shapes
src/near-units.ts   exact NEAR/yocto conversion
src/demo.ts         deterministic 10-step demo (npm run demo)
src/send.ts         single-action CLI (npm run send -- ...)
test/               37 node:test unit tests (policy, audit, executor, config)
policy.example.json the demo policy as a file
.env.example        configuration reference (placeholders only, no secrets)
```

## License

MIT — see `LICENSE`.

## Build Disclosure

Build Disclosure: AI-built. Built by AI agents (Tree / Muse fleet)
directed by Rene Turcios for NEAR HACKATHON. Every part of this repository —
design, code, tests, and this README — was produced by AI agents under
human direction; the human's role and the steps reserved for the human
(submission, payout account, demo post) follow the hackathon's published
procedure. No part of this disclosure is hidden anywhere it matters: it is
here, in the open, on purpose.
