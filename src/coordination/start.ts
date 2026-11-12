import { createCoordinationApp, loadApiSigningKey } from './api';
import { DcapNearAiEvidenceVerifier } from '../privacy/dcap-verifier';
import { NearAiPrivateReviewer } from '../privacy/near-ai';

const port = Number(process.env.PORT ?? 4200);
const host = process.env.HOST ?? '0.0.0.0';
const adminToken = process.env.STREAMLINE_ADMIN_TOKEN;
if (!adminToken) throw new Error('STREAMLINE_ADMIN_TOKEN is required');
const nearAiKey = process.env.NEARAI_CLOUD_API_KEY;
const privateReviewer = nearAiKey
  ? new NearAiPrivateReviewer(nearAiKey, new DcapNearAiEvidenceVerifier())
  : undefined;

createCoordinationApp({
  adminToken,
  signingKey: loadApiSigningKey(),
  daoId: process.env.SPUTNIK_DAO_ID,
  nearRpcUrl: process.env.NEAR_RPC_URL,
  privateReviewer,
}).listen(port, host, () => console.log(`[coordination] listening on http://${host}:${port}`));
