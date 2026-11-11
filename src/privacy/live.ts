import { DcapNearAiEvidenceVerifier } from './dcap-verifier';
import { NearAiPrivateReviewer } from './near-ai';

const apiKey = process.env.NEARAI_CLOUD_API_KEY;
if (!apiKey) throw new Error('NEARAI_CLOUD_API_KEY is required');
const reviewer = new NearAiPrivateReviewer(apiKey, new DcapNearAiEvidenceVerifier());
const result = await reviewer.review(
  'The deliverable must state that two plus two equals four and contain no personal data.',
  'Two plus two equals four. This fictional sample contains no personal data.',
);
console.log(JSON.stringify(result, null, 2));
if (!result.attestation.verified || !result.responseVerification.verified) process.exitCode = 1;
