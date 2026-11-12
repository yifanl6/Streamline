# NEAR setup

Keep all credentials out of this document and every other tracked file.

## 1. Configure local environment variables

From the repository root:

```bash
cp .env.example .env
```

Open `.env` locally and set:

```dotenv
SPUTNIK_DAO_ID=your-dao.sputnik-dao.near
NEAR_RPC_URL=https://rpc.mainnet.near.org
NEARAI_CLOUD_API_KEY=replace-with-a-new-key
NEAR_AI_MODEL=zai-org/GLM-5.1-FP8
```

The `.env` file is ignored by Git. Never commit it, paste it into an issue, or show it during the demo.

## 2. What is safe to store

- `SPUTNIK_DAO_ID` is a public account identifier.
- `NEAR_RPC_URL` and the model name are public configuration.
- `NEARAI_CLOUD_API_KEY` is secret and belongs only in `.env` or a deployment secret manager.
- A Meteor recovery phrase or wallet private key must stay in Meteor/offline backup. Streamline does not require either one.

If an API key was pasted into a Markdown file, chat, screenshot, or commit, revoke it and create a replacement before continuing. If a wallet recovery phrase or private key was exposed, create a new wallet and transfer assets and roles as soon as possible.

## 3. Validate the integrations

```bash
npm run near:check
npm run privacy:live
```

Then start the backend and draft interface:

```bash
npm run coordination
```

Open `http://localhost:4200`.
