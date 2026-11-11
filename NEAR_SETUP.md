# NEAR setup for Streamline

## Create the Sputnik DAO ID through Trezu

Recommended hackathon path:

1. Open [Trezu Create Treasury](https://trezu.app/create).
2. Select **Public**. This matches the Social Money use case: visible budgets, bounties, claims, and reputation evidence.
3. Enter the display name, such as `Streamline Community`.
4. Choose an available account name, such as `streamline-community`.
5. Trezu shows the complete account before creation: `streamline-community.sputnik-dao.near`. That full account is the `SPUTNIK_DAO_ID`—not the display name and not your personal wallet.
6. Continue to the wallet, sign in with your NEAR wallet, and approve creation. Trezu currently states that it covers treasury-launch network fees.
7. Add council members and set the voting threshold. Keep at least two recoverable council wallets for a real treasury.
8. Deposit only the small amount needed for the demo.

For a Trezu mainnet treasury, configure:

```bash
export SPUTNIK_DAO_ID='streamline-community.sputnik-dao.near'
export NEAR_RPC_URL='https://rpc.mainnet.near.org'
npm run near:check
```

Do not combine a `.near` DAO with the testnet RPC or a `.testnet` DAO with the mainnet RPC. If the team uses Trezu's test environment instead, use the exact DAO account it creates and `https://rpc.testnet.near.org`.

## Create the NEAR AI Cloud API key

1. Open [NEAR AI Cloud](https://cloud.near.ai) and create or sign in to your account.
2. Add credits. Hackathon participants can also check the current credit link in the official hackathon instructions/NEAR Builders dashboard.
3. Open **API Keys** in the Cloud dashboard.
4. Choose **Generate API Key**, give it a Streamline-specific name, and copy it immediately.
5. Store it only in your shell or deployment secret manager:

```bash
export NEARAI_CLOUD_API_KEY='your-key'
export NEAR_AI_MODEL='zai-org/GLM-5.1-FP8'
npm run privacy:live
```

The live check uses fictional text. It exits nonzero unless Intel TDX, nonce/signer binding, measured configuration, RTMR3, NVIDIA GPU evidence, exact response hashes, and the response signature all verify.

Never paste the API key into the dashboard, commit it, include it in screenshots, or place it in a frontend bundle. The browser sends review requests to the Streamline backend; only the backend talks to NEAR AI Cloud.

## Start the draft interface

```bash
export STREAMLINE_ADMIN_TOKEN='a-long-random-secret'
export STREAMLINE_SIGNING_KEY='output-from-npm-run-coordination-keygen'
export SPUTNIK_DAO_ID='your-dao.sputnik-dao.near'
export NEAR_RPC_URL='https://rpc.mainnet.near.org'
export NEARAI_CLOUD_API_KEY='your-key'
npm run coordination
```

Open `http://localhost:4200`. The admin token is entered into the Operator Session panel and retained only in browser session storage. The public board and reputation lookup do not expose that token.
