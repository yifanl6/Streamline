# Streamline

Streamline is coordination and payments infrastructure for community-owned work. It sits on top of a Sputnik DAO treasury and helps a community turn a decision into a bounded program, a public task, a private AI review, and receipt-backed reputation. Sputnik remains the approval and custody layer; Streamline organizes what the community does with it.

The prototype combines four hackathon tracks:

- **Social money:** shared programs, contributor tasks, and transparent budget state.
- **Agent economy:** limited service budgets and policy-controlled agent payments.
- **AI security and defense:** spending rules are checked before a wallet signature is created.
- **Privacy:** deliverables can be reviewed through attested NEAR AI infrastructure without storing their plaintext in Streamline.

## Run the coordination app

Keep credentials in `.env`, which is ignored by Git. Never paste a Meteor recovery phrase or wallet private key into this project.

```bash
npm install
npm run near:check       # confirm the Sputnik DAO connection
npm run privacy:live     # confirm the NEAR AI private-review connection
npm run coordination     # open http://localhost:4200
```

The hosted dashboard may take roughly a minute to wake on Render's free tier. The first page response includes a public server snapshot so the dashboard can still render while background refreshes recover.

## Demo video runbook

Use testnet values and fictional content throughout the demo. Create the program shortly before recording because the free hosted service stores prototype programs, tasks, and reputation events in memory; a service restart clears them.

### 1. Prepare the demo

1. Open Streamline and wait for **Coordination backend online**.
2. On **Overview**, select **Community bounty**. Briefly click through its interactive flow: define work, set boundaries, verify privately, and approve or track.
3. Select **Sync DAO**. Show that the treasury data comes from the configured Sputnik DAO.
4. Open **How to use** and show the readiness checklist.
5. Open **Build & fund**, enter `STREAMLINE_ADMIN_TOKEN`, and select **Unlock**. This token is an API admin credential, not a wallet key.

### 2. Create a practice program

Enter the following under **Build & fund → Create program and task**:

| Field | Practice value |
|---|---|
| Program ID | `demo-research-bounty-01` |
| Bounty ID | `0` |
| Network | `monad-testnet` |
| Asset | `tUSDC` |
| Total base units | `50000` |
| Expires in hours | `24` |
| Allowed payees | `data-agent` |
| Allowed services | `account-risk` |

Select **Register program**. If the ID already exists in the current server session, increment the suffix to `-02` rather than reusing it.

Suggested narration: “The community is not giving an agent open-ended treasury access. This program limits the asset, total amount, recipient, service, and expiration before any payment can be signed.”

### 3. Post and claim a practice task

1. Choose the practice program from the program selector.
2. Use the task title: `Review a community wallet risk report`.
3. Select **Post task**.
4. Return to **Overview**. The task should appear as **open**.
5. Select **Claim** and enter the fictional named account `demo-contributor.testnet`.
6. The task should now appear as **claimed** with that contributor.

Suggested narration: “The task and budget are public, while the sensitive work product can remain private. The named account will earn reputation only after a signed completion receipt—not merely for claiming the task.”

### 4. Run a practice private TEE review

Open **Privacy & trust** and copy these fictional inputs.

**Acceptance criteria**

```text
Pass only if the deliverable identifies at least two wallet-risk signals, gives a low, medium, or high risk rating, recommends one follow-up action, and contains no private keys, recovery phrases, or personal data.
```

**Deliverable**

```text
Risk rating: medium. Signal one: the wallet is newly created and has little transaction history. Signal two: most activity is concentrated around a single counterparty. Recommended follow-up: request an additional independent transaction-history review before approving a larger payment. This report contains only fictional test data and no private credentials or personal information.
```

Select **Run verified review**. A successful demo should return:

- a `pass` decision and short reasons;
- `attestationVerified: true`;
- `responseVerified: true`;
- request and response hashes instead of stored plaintext.

Suggested narration: “Streamline verifies the confidential-compute evidence before sending the work, then verifies the signed model response. The public record gets the verdict and hashes, not the private deliverable.”

If the request fails, confirm that the NEAR AI key has credits and that `NEAR_AI_MODEL` uses the current canonical model name rather than an alias.

### 5. Run a practice reputation lookup

1. Under **Privacy & trust → Reputation lookup**, enter `demo-contributor.testnet`.
2. Before a completion receipt is recorded, the expected result is score `0`, tier `new`, and an empty history.
3. Explain that this is intentional: claiming a task or receiving an AI verdict alone cannot create reputation.

Suggested narration: “Streamline does not award reputation from self-reported profiles. A contributor receives points only when a trusted coordinator issues a signed receipt for completed, passing work. The score can then be traced back to that receipt.”

The current dashboard does not yet expose receipt issuance as a button. The API and automated tests cover the full reputation path: a passing completion gives 10 points, on-time delivery gives 3, and independent review gives 2, producing score `15` and tier `proven`. Do not claim that the browser lookup will change until a completion receipt has actually been posted.

### 6. Finish the video

Return to **Overview** and show:

- the connected Sputnik treasury;
- one registered program and its remaining budget;
- the claimed practice task;
- the interactive workflow connecting the product sections.

Close with: “Streamline does not rebuild the multisig. It gives communities programmable budgets, private verification, controlled agent spending, and evidence-backed reputation on top of the treasury they already govern.”

## Tests to run before recording

```bash
npm run near:check          # live DAO policy, bounty, and proposal read
npm run privacy:live        # live attested private-review request
npm run check               # typecheck, unit/API tests, and attack simulation
```

Expected automated result: 14 tests pass in the restricted development sandbox and one HTTP transport test is skipped because the sandbox cannot open a loopback listener. Outside that restriction, the API test exercises program creation, claiming, policy authorization, settlement, signed receipts, and a 15-point `proven` reputation result.

## Agent payment rails

Three AI-style agents pay each other per HTTP request using an [x402](https://x402.org)-style `402 Payment Required` flow with a test stablecoin. There are two implementations: **Monad** (EVM, live on testnet) and **Solana**.

```
orchestrator ──$0.02/call──▶ analyst-agent ──$0.005/call──▶ data-agent ──▶ chain RPC
 (buyer, hard budget)        (seller AND buyer)             (seller)
```

The analyst is the interesting node. It earns from the orchestrator and spends on the data agent within the same request. It also returns the upstream payment transaction as **provenance**, and the orchestrator checks on-chain that the data agent really received $0.005 in that transaction.

## Monad payment rail (live on testnet)

| | |
|---|---|
| Network | Monad testnet, chain 10143 |
| Test stablecoin (tUSDC, EIP-3009) | [`0x0f1a488c1bd726Ae27116336Ce5E869B15491AaA`](https://testnet.monadexplorer.com/address/0x0f1a488c1bd726Ae27116336Ce5E869B15491AaA) |
| Analyst agent (seller + buyer) | [`0xDC250fC2606f08E5d170c9532B4A748528C304c8`](https://testnet.monadexplorer.com/address/0xDC250fC2606f08E5d170c9532B4A748528C304c8) |
| Data agent (seller) | [`0xD8aC58a53e10220012e8e44Cae4090611e6f25C6`](https://testnet.monadexplorer.com/address/0xD8aC58a53e10220012e8e44Cae4090611e6f25C6) |
| Orchestrator (buyer) | [`0x6f5E91062df02A53f6cf9EA9b8C80545aCEC11FB`](https://testnet.monadexplorer.com/address/0x6f5E91062df02A53f6cf9EA9b8C80545aCEC11FB) |

The full record is in [`deployments/monad-testnet.json`](deployments/monad-testnet.json). The agents' transaction histories on the explorer show every settled payment.

### How a payment works on Monad (x402 "exact" scheme, EVM)

1. The client calls `GET /risk/:address`. The server replies `402` with the price, token, `payTo`, the token's EIP-712 domain, and a single-use **seller-issued nonce**.
2. The client checks its spend policy (token, per-call cap, total budget, payee allow-list). It then signs an **EIP-3009 `TransferWithAuthorization`** for exactly that price, using the seller's nonce, and retries with an `X-PAYMENT` header. **The buyer never needs MON.**
3. The server verifies the authorization, burns the nonce, and **simulates** `transferWithAuthorization`. It then submits the call itself, paying gas, waits for the receipt, and serves the response with an `X-PAYMENT-RESPONSE` receipt.

### Run it

```bash
npm install
npm run monad:setup        # first time only: wallets, deploy tUSDC, fund agents (prints the treasury to fund)
npm run monad:live         # data + analyst + dashboard, plus a public Cloudflare quick-tunnel URL
```

`monad:live` prints a public `https://….trycloudflare.com` URL. **Run live demo** on that page buys three reports: two settle on Monad, and the third is refused by the orchestrator's budget. Every transaction links to the explorer. The same URL proxies the agents under `/agents/analyst/` and `/agents/data/`, so any x402 client can pay them directly. You need [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed (`brew install cloudflared`); set `NO_TUNNEL=1` to stay local.

To run the pieces separately:

```bash
npm run monad:data-agent          # :4101
npm run monad:analyst-agent       # :4102
npm run monad:orchestrator        # CLI buyer; add addresses to analyze specific ones
npm run monad:attack              # 14 adversarial checks against the live data agent
npm run monad:web                 # dashboard on :4100
```

For mainnet, set `MONAD_NETWORK=monad` and run `monad:setup` with a funded treasury. To host anywhere, run `npm start` with `AGENT=data|analyst|web`, `PORT`, `<ROLE>_PRIVATE_KEY`, `DATA_AGENT_URL`, and `ANALYST_URL`.

### Security model (Monad)

The seller submits the buyer's authorization and pays the gas, which makes it a target. `src/monad/x402.ts` and `src/monad/server.ts` reject:

| Attack | Defense |
|---|---|
| Underpay, wrong recipient | Exact `value` and `to`, checked against the seller's own quote |
| Pay in a worthless token, or replay a signature from another chain | EIP-712 domain (`verifyingContract`, `chainId`) is part of the signature |
| Tamper with the amount or `from` after signing | Signature recovery must match `from` over the exact message |
| Expired, not-yet-valid, or open-ended authorizations | Validity window: usable now, still valid long enough to land, and at most `maxTimeoutSeconds` long |
| Gas griefing with a valid signature from an empty wallet | Simulate before submitting, so failures cost the seller nothing |
| Forged nonce, or a quote reused on another resource | Seller-issued nonce bound to resource and price, burned before submission |
| Replay a settled payment | Burned off-chain, and EIP-3009 `authorizationState` enforces it again on-chain |

`npm run monad:attack` ran all 14 attacks against the live testnet agent, and **14 of 14 were blocked**. The seller's only balance changes were one honest payment (+$0.005) and its gas.

The seller can't be drained through its own signature: it only ever calls `transferWithAuthorization` on one fixed token contract, so the buyer never chooses what the seller signs.

### Economics on Monad

Each settlement is one `transferWithAuthorization`. With the estimate +20% as the gas limit, that's about 118k gas, which at the testnet's ~102 gwei is about **0.012 MON per payment**. Monad charges the gas *limit*, not gas used, so the verifier keeps the limit tight. Whether $0.005 calls make sense on mainnet depends on the MON price and mainnet gas price: the fee share is `0.012 MON × price ÷ call price`. Below that break-even point you'd batch, using the same cumulative-IOU idea as the Solana Next steps below.

Measured latency for a two-hop paid request (the orchestrator pays the analyst, and the analyst pays the data agent, each waiting for a receipt) was about 0.7–2s on testnet.

## Solana payment rail

### The flow (x402 "exact" scheme)

1. The client calls `GET /risk/:address`. The server replies `402` with the price, token mint, `payTo`, `feePayer`, and a single-use nonce.
2. The client checks its **spend policy**: token, per-call cap, total budget, and payee allow-list. It then builds a `TransferChecked + Memo(nonce)` transaction, signs **only as token owner**, and retries with an `X-PAYMENT` header.
3. The server verifies the transaction instruction by instruction and burns the nonce. It then co-signs as fee payer (so buyers need no SOL), submits, waits for `confirmed`, and serves the response with an `X-PAYMENT-RESPONSE` receipt.

### Run it (local validator, about 2 minutes)

Install the Solana CLI (Agave): `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`, then:

```bash
npm install
solana-test-validator --reset          # terminal 1
npm run setup                          # wallets, SOL, test stablecoin, token accounts
npm run demo                           # starts both agents, runs orchestrator + attack suite
```

Or run each piece in its own terminal, which works better for a live demo:

```bash
npm run data-agent                     # terminal 2
npm run analyst-agent                  # terminal 3
npm run orchestrator                   # terminal 4 (or: npm run orchestrator -- <address> ...)
npm run attack                         # adversarial checks against the data agent
```

If you restart the validator with `--reset`, run `npm run setup` again. It keeps the wallets and recreates the mint.

**Devnet:** `RPC_URL=https://api.devnet.solana.com NETWORK=solana-devnet npm run setup`. Pass the same env vars to every other command. Faucet airdrops are rate-limited, so if setup fails, top up the printed address at [faucet.solana.com](https://faucet.solana.com) and re-run it. Wallets are stored per network under `.wallets/<network>/`.

**Expected orchestrator output:** two paid reports, each with provenance verified on-chain. The third call is then refused by the orchestrator's own budget policy ($0.05 budget, $0.02 per call), and the on-chain balance change matches the tracked spend:

```
▶ risk report for 693tZNaD…
  paid $0.0200  tx 4xyw6YnS…  (1212 ms)
  score 40/100 (medium)
    +25  new-account: first activity under an hour ago
    +15  low-activity: 3 transactions on record
  provenance: data agent received $0.0050 in 2qWb92PC… ✓ verified on-chain
  budget left $0.0300
...
▶ risk report for 44G247Sm…
  ⛔ refused by spend policy: price 20000 exceeds remaining budget 10000 (spent 40000 of 50000)

tracked spend $0.0400 across 2 payments
on-chain balance change $0.0400 ✓ matches
```

### Layout

| File | Role |
|---|---|
| `src/x402/verify.ts` | Pure verifier for buyer-signed payment transactions (the security boundary) |
| `src/x402/server.ts` | Express paywall middleware: quote → verify → burn nonce → co-sign → settle → serve |
| `src/x402/client.ts` | Paying HTTP client with a hard spend policy |
| `src/x402/nonce.ts` | Single-use nonces bound to resource and price |
| `src/agents/*.ts` | data agent, analyst agent (seller + buyer), orchestrator, toy risk heuristic |
| `src/scripts/attack.ts` | 15 adversarial checks against a live seller |
| `src/monad/*` | The Monad/EVM implementation: EIP-3009 verifier, paywall, client, agents, dashboard, attack suite |
| `contracts/TestUSD.sol` | Test stablecoin with EIP-3009 and a public faucet (OpenZeppelin ERC20 + EIP712) |

Each agent describes its offers at `GET /` (`curl localhost:4002/`).

### Security model

The seller signs as fee payer, which makes it a target. `src/x402/verify.ts` rejects:

| Attack | Defense |
|---|---|
| Drain the fee payer (SOL transfer out of it, or a token transfer from the seller) | The facilitator key may appear only as fee payer, never inside an instruction |
| Priority-fee or compute griefing | Caps on compute-unit price (5,000 µlamports) and limit (100k CU) |
| Fee inflation via extra signers | Exactly two signers: fee payer + token owner |
| Underpay, wrong token, wrong decimals, wrong recipient | Exact amount, mint, decimals, and recipient ATA |
| Replay, or reusing a quote on another resource | Single-use nonce in a Memo, burned before submission, bound to resource and price |
| Smuggled instructions | Program allow-list (ComputeBudget, Token, Memo), and only `TransferChecked` on Token |

`npm run attack` exercises all of these against a live agent and then checks the seller's balances. The only change should be one honest payment: **-10,001 lamports, +5,000 token units**.

The buyer side is defended too. `X402Client` checks the payee allow-list, per-call cap, and remaining budget **before signing**, and it reserves budget so concurrent calls can't overspend.

### Economics

Settlement costs the seller 10,000 lamports for the two signatures (payer + fee payer), plus a 1-lamport priority fee. At $150/SOL that is about **$0.0015 per payment**:

| Price per call | Fee as share of revenue |
|---|---|
| $0.02 | ~7.5% |
| $0.005 | ~30% |
| $0.002 | ~75% |
| $0.001 | ~150% (loses money) |

Per-call on-chain settlement stops making sense below about half a cent. Under that, you need batching (see Next steps).

### Known limitations (deliberate, for clarity)

- **Pay-then-fail:** if the analyst's upstream call fails after the customer paid, it returns `502` and logs "refund owed". There is no automated refund yet.
- **Latency:** each paid call waits for `confirmed`. Locally that is about 1s end to end for a two-hop request; it takes longer on devnet.
- **In-memory nonces:** fine for one process. Use Redis for multiple instances.
- **Not certified x402-compatible:** wire shapes follow x402 v1, but the facilitator logic is self-hosted. Swap in `@x402/*` or a hosted facilitator to interoperate with other agents.
- **The risk score is a transparent toy heuristic, not a model.** Every point is traceable to a listed factor.

### Next steps

- **Batched settlement:** sign cumulative IOUs off-chain, and settle every N calls or every $X.
- **Refund path:** the seller refunds automatically when it can't deliver after settlement.
- **Discovery:** publish offers (`GET /`) in a registry so agents can find and compare sellers.
- **Any-token payments:** accept any SPL token, swap via Jupiter, and settle exact USDC to the seller.
