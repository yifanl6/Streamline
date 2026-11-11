# Streamline coordination backend

This backend adds the four-track coordination layer without replacing Sputnik DAO/Trezu custody. It is intentionally separate from the existing Solana and Monad x402 settlement code.

The draft operator dashboard is served at `/` by the coordination process. It includes the public task board, program/task creation, named-account claims, DAO sync, private review, and reputation lookup. See [`NEAR_SETUP.md`](NEAR_SETUP.md) before connecting live credentials.

## What is implemented

- Atomic DAO-program budgets with reserve, settle, and release accounting.
- Ed25519-signed task capabilities scoped by task, subject, payee, method, resource, asset, amount, calls, and expiry.
- Evidence-backed `allow` / `warn` / `block` payment policy. Blocked attempts never consume capability use or reach signing.
- One-counter agent quote negotiation with seller-signed, expiring quotes.
- Signed work receipts binding DAO/bounty, request, inputs, outputs, algorithm, payments, review, and total cost.
- Non-transferable reputation derived only from verified receipts for claimed tasks.
- Sputnik DAO read adapter and wallet-signable action builders for bounty creation, claim, completion, and voting. No DAO private key is held by the backend.
- Stateless NEAR AI Cloud private review. The live verifier checks Intel DCAP/TCB status, debug mode, nonce and signer binding, MRCONFIGID, RTMR3 event-log replay, NVIDIA GPU evidence, exact request/response hashes, and the response signature.
- Authenticated JSON API and public read-only board/reputation endpoints.

## Run

```bash
cp .env.example .env
npm run coordination:keygen       # put the printed key into .env
export STREAMLINE_ADMIN_TOKEN='use-a-long-random-value'
export STREAMLINE_SIGNING_KEY='value-from-keygen'
export SPUTNIK_DAO_ID='your-dao.sputnik-dao.testnet'
npm run coordination              # http://localhost:4200
```

Node does not automatically load `.env`; export the values in your shell or use your deployment platform's secret manager. Never commit the generated signing key, admin token, wallet keys, or NEAR AI key.

## Verify

```bash
npm run check                      # typecheck, 12 tests, security attack
npm run near:check                 # live read against SPUTNIK_DAO_ID
NEARAI_CLOUD_API_KEY=... npm run privacy:live
```

The privacy live check uses fictional data and exits nonzero if any hardware or response evidence fails. `UpToDate` is the only accepted Intel TCB status by default.

## API

Administrative writes require `Authorization: Bearer $STREAMLINE_ADMIN_TOKEN`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service key and DAO configuration |
| `GET` | `/v1/board` | Public tasks and budget totals |
| `POST` | `/v1/programs` | Register a DAO-approved program budget |
| `POST` | `/v1/tasks` | Create a task inside a program |
| `POST` | `/v1/tasks/:id/claim` | Bind a named NEAR contributor |
| `POST` | `/v1/capabilities` | Issue a narrowed, signed task capability |
| `POST` | `/v1/negotiate` | Execute the one-counter procurement flow |
| `POST` | `/v1/security/reports` | Add a trusted, evidence-backed counterparty report |
| `POST` | `/v1/security/authorize` | Apply counterparty and capability policy before signing |
| `POST` | `/v1/programs/:id/reservations` | Atomically reserve spend |
| `POST` | `/v1/programs/:id/reservations/:reservation/settle` | Record on-chain settlement |
| `POST` | `/v1/programs/:id/reservations/:reservation/release` | Release failed purchase reservation |
| `POST` | `/v1/private-review` | Run verified private TEE review without retaining plaintext |
| `POST` | `/v1/receipts` | Issue a task-linked signed work receipt |
| `POST` | `/v1/reputation/completed` | Award idempotent receipt-backed reputation |
| `GET` | `/v1/reputation/:accountId` | Public score, tier, and traceable history |
| `GET` | `/v1/dao` | Read Sputnik policy, bounties, and proposals |
| `POST` | `/v1/dao/actions/add-bounty` | Build an unsigned Sputnik `AddBounty` proposal action |
| `POST` | `/v1/dao/actions/claim-bounty` | Build an unsigned bounty-claim action with the live DAO bond |
| `POST` | `/v1/dao/actions/complete-bounty` | Build an unsigned bounty-completion action |
| `POST` | `/v1/dao/actions/vote` | Build an unsigned Sputnik proposal vote |

## Trust boundaries

- Sputnik DAO/Trezu remains the treasury and payout authority.
- DAO-changing actions are returned as transaction descriptions for a wallet to sign; this service never stores a DAO full-access key.
- The coordination signing key authenticates capabilities and receipts but cannot move DAO funds.
- Existing x402 clients remain responsible for final payment-transaction verification.
- Sensitive review text exists only in request-local memory. The API returns hashes, verdict, and attestation checks; it does not persist or log plaintext.
- In-memory budgets/tasks are demo state. Before multi-instance production deployment, persist them transactionally and use a shared replay store.

## Dependency audit note

Express was upgraded to `4.22.3` to remove its fixable request-parser and routing advisories. `npm audit --omit=dev` still reports transitive advisories through the legacy Solana 1.x/SPL stack and the NEAR-documented `@phala/dcap-qvl` verifier. npm offers only breaking replacements (Solana web3 3.x, an incompatible SPL downgrade, or an older DCAP package), so they were not force-applied during the hackathon build. Keep the coordination service isolated, enforce the existing request-size limit, and migrate those upstream stacks before production use.

## Test coverage

The suite covers deterministic signatures, tampering, overspend and concurrency reservations, capability scope/expiry/call limits, untrusted blocklist reports, pre-sign blocking, negotiation acceptance/walk-away, receipt reconciliation, idempotent reputation, Sputnik RPC/action encoding, fail-closed privacy behavior, full attestation bindings with synthetic verified evidence, exact response signatures, and the HTTP workflow.
