import { createHash, randomBytes } from 'node:crypto';

export interface EvidenceCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AttestationVerification {
  verified: boolean;
  checks: EvidenceCheck[];
  signer?: string;
  signingAlgorithm?: string;
  verifiedSigners?: Array<{ address: string; algorithm: string; scope: 'gateway' | 'model' }>;
}

export interface ResponseVerification extends AttestationVerification {
  signatureKind?: 'provider_tee' | 'gateway';
}

export interface NearAiEvidenceVerifier {
  /** Must cryptographically verify Intel quote/event log/measurements, not merely echoed JSON fields. */
  verifyPreflight(report: unknown, nonce: string, model: string): Promise<AttestationVerification>;
  /** Must verify exact request/response hashes and signature against the verified preflight signer. */
  verifyResponse(input: {
    signature: unknown;
    preflight: AttestationVerification;
    model: string;
    requestHash: string;
    responseHash: string;
  }): Promise<ResponseVerification>;
}

export interface PrivateReview {
  decision: 'pass' | 'fail';
  reasons: string[];
  model: string;
  requestHash: string;
  responseHash: string;
  nonce: string;
  attestation: AttestationVerification;
  responseVerification: ResponseVerification;
}

export class PrivateReviewError extends Error {}

/**
 * Stateless NEAR AI Cloud client. Sensitive task content exists only in local variables for the
 * duration of review; callers receive hashes and the parsed verdict, never the raw prompt.
 */
export class NearAiPrivateReviewer {
  constructor(
    private readonly apiKey: string,
    private readonly verifier: NearAiEvidenceVerifier,
    private readonly model = process.env.NEAR_AI_MODEL ?? 'zai-org/GLM-5.1-FP8',
    private readonly baseUrl = 'https://cloud-api.near.ai/v1',
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new PrivateReviewError('NEAR AI Cloud API key is required');
  }

  async review(criteria: string, deliverable: string): Promise<PrivateReview> {
    const nonce = randomBytes(32).toString('hex');
    const attestationUrl = new URL(`${this.baseUrl}/attestation/report`);
    attestationUrl.searchParams.set('model', this.model);
    attestationUrl.searchParams.set('signing_algo', 'ecdsa');
    attestationUrl.searchParams.set('nonce', nonce);

    const reportResponse = await this.fetcher(attestationUrl, {
      headers: { accept: 'application/json', 'x-no-aliasing': 'true', authorization: `Bearer ${this.apiKey}` },
    });
    if (!reportResponse.ok) throw new PrivateReviewError(await responseError('attestation request', reportResponse));
    const report: unknown = await reportResponse.json();
    const attestation = await this.verifier.verifyPreflight(report, nonce, this.model);
    if (!attestation.verified) throw new PrivateReviewError('TEE preflight evidence did not verify');

    const requestBody = JSON.stringify({
      model: this.model,
      stream: false,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Review the deliverable against the criteria. Return JSON only: {"decision":"pass|fail","reasons":["..."]}.' },
        { role: 'user', content: `CRITERIA:\n${criteria}\n\nDELIVERABLE:\n${deliverable}` },
      ],
    });
    const requestHash = digest(requestBody);
    const completionResponse = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-encoding': 'identity',
        'x-no-aliasing': 'true',
      },
      body: requestBody,
    });
    const responseBytes = await completionResponse.text();
    if (!completionResponse.ok) throw new PrivateReviewError(responseTextError('private review', completionResponse.status, responseBytes));
    const responseHash = digest(responseBytes);
    const completion = parseJson(responseBytes, 'completion') as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!completion.id) throw new PrivateReviewError('completion has no id');

    const signatureUrl = new URL(`${this.baseUrl}/signature/${encodeURIComponent(completion.id)}`);
    signatureUrl.searchParams.set('model', this.model);
    signatureUrl.searchParams.set('signing_algo', 'ecdsa');
    const signatureResponse = await this.fetcher(signatureUrl, {
      headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}` },
    });
    if (!signatureResponse.ok) throw new PrivateReviewError(await responseError('response signature', signatureResponse));
    const signature: unknown = await signatureResponse.json();
    const responseVerification = await this.verifier.verifyResponse({ signature, preflight: attestation, model: this.model, requestHash, responseHash });
    if (!responseVerification.verified) throw new PrivateReviewError('TEE response signature did not verify');

    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new PrivateReviewError('completion has no review result');
    const verdict = parseJson(content, 'review result') as { decision?: string; reasons?: unknown };
    if ((verdict.decision !== 'pass' && verdict.decision !== 'fail') || !Array.isArray(verdict.reasons) || !verdict.reasons.every((r) => typeof r === 'string')) {
      throw new PrivateReviewError('model returned an invalid review schema');
    }
    return { decision: verdict.decision, reasons: verdict.reasons as string[], model: this.model, requestHash, responseHash, nonce, attestation, responseVerification };
  }
}

/** Fails closed until a DCAP/event-log verifier is wired in; echoed nonce fields are not proof. */
export class FailClosedEvidenceVerifier implements NearAiEvidenceVerifier {
  async verifyPreflight(_report: unknown, _nonce: string, _model: string): Promise<AttestationVerification> {
    return { verified: false, checks: [{ name: 'cryptographic quote verification configured', passed: false }] };
  }
  async verifyResponse(): Promise<ResponseVerification> {
    return { verified: false, checks: [{ name: 'response signature verification configured', passed: false }] };
  }
}

const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
function parseJson(text: string, label: string): unknown {
  try { return JSON.parse(text); } catch { throw new PrivateReviewError(`${label} is not valid JSON`); }
}

async function responseError(label: string, response: Response): Promise<string> {
  return responseTextError(label, response.status, await response.text());
}

function responseTextError(label: string, status: number, text: string): string {
  let detail = '';
  try {
    const payload = JSON.parse(text) as { error?: string | { message?: string }; message?: string; detail?: string };
    detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? payload.detail ?? '';
  } catch {
    detail = text;
  }
  const safeDetail = detail
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return `${label} failed (${status})${safeDetail ? `: ${safeDetail}` : ''}`;
}
