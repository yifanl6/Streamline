import { createHash } from 'node:crypto';
import { getCollateralAndVerify, type VerifiedReport } from '@phala/dcap-qvl';
import { getAddress, recoverMessageAddress, type Hex } from 'viem';
import type {
  AttestationVerification,
  EvidenceCheck,
  NearAiEvidenceVerifier,
  ResponseVerification,
} from './near-ai';

interface NearReport {
  intel_quote: string;
  event_log: string | EventLogEntry[];
  request_nonce: string;
  signing_address: string;
  signing_algo: 'ecdsa' | 'ed25519';
  tls_cert_fingerprint?: string;
  nvidia_payload?: string;
  info: { tcb_info: string | { app_compose: string } };
}

interface EventLogEntry {
  imr: number;
  event_type: number;
  event: string;
  event_payload?: string;
  digest?: string;
}

interface AttestationApiResponse {
  gateway_attestation?: NearReport;
  model_attestations?: NearReport[];
}

interface SignatureResponse {
  signature_kind?: 'provider_tee' | 'gateway';
  text?: string;
  signature?: Hex;
  signing_address?: string;
  signing_algo?: string;
  error_code?: string;
}

type QuoteVerifier = (bytes: Buffer) => Promise<VerifiedReport>;

/** Strict verifier implementing NEAR's nonce, quote, debug, MRCONFIGID, RTMR3, GPU, and signature checks. */
export class DcapNearAiEvidenceVerifier implements NearAiEvidenceVerifier {
  constructor(
    private readonly acceptedTcbStatuses: ReadonlySet<string> = new Set(['UpToDate']),
    private readonly quoteVerifier: QuoteVerifier = (bytes) => getCollateralAndVerify(bytes),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verifyPreflight(raw: unknown, nonce: string, _model: string): Promise<AttestationVerification> {
    const checks: EvidenceCheck[] = [];
    const response = raw as AttestationApiResponse;
    const signers: NonNullable<AttestationVerification['verifiedSigners']> = [];
    try {
      if (!response?.gateway_attestation) throw new Error('gateway attestation is missing');
      await this.verifyReport(response.gateway_attestation, nonce, false, checks);
      signers.push({ address: response.gateway_attestation.signing_address, algorithm: response.gateway_attestation.signing_algo, scope: 'gateway' });
      const models = response.model_attestations ?? [];
      if (models.length === 0) throw new Error('model attestations are missing');
      for (const report of models) {
        await this.verifyReport(report, nonce, true, checks);
        signers.push({ address: report.signing_address, algorithm: report.signing_algo, scope: 'model' });
      }
      return {
        verified: true,
        checks,
        signer: signers.find((s) => s.scope === 'model')?.address,
        signingAlgorithm: signers.find((s) => s.scope === 'model')?.algorithm,
        verifiedSigners: signers,
      };
    } catch (error) {
      checks.push({ name: 'attestation policy', passed: false, detail: (error as Error).message });
      return { verified: false, checks, verifiedSigners: signers };
    }
  }

  async verifyResponse(input: {
    signature: unknown;
    preflight: AttestationVerification;
    model: string;
    requestHash: string;
    responseHash: string;
  }): Promise<ResponseVerification> {
    const checks: EvidenceCheck[] = [];
    try {
      if (!input.preflight.verified) throw new Error('preflight was not verified');
      const payload = input.signature as SignatureResponse;
      if (payload.error_code) throw new Error(`signature unavailable: ${payload.error_code}`);
      if (payload.signature_kind !== 'provider_tee' && payload.signature_kind !== 'gateway') throw new Error('unknown signature kind');
      if (payload.signing_algo !== 'ecdsa') throw new Error('only ECDSA response signatures are accepted');
      if (!payload.text || !payload.signature || !payload.signing_address) throw new Error('malformed signature response');
      const expected = payload.signature_kind === 'provider_tee'
        ? `${input.model}:${input.requestHash}:${input.responseHash}`
        : `${input.requestHash}:${input.responseHash}`;
      if (payload.text !== expected) throw new Error('signed request/response hashes do not match exact bytes');
      checks.push({ name: 'exact request and response hashes', passed: true });

      const recovered = await recoverMessageAddress({ message: payload.text, signature: payload.signature });
      if (getAddress(recovered) !== getAddress(payload.signing_address)) throw new Error('response signature is invalid');
      checks.push({ name: 'ECDSA response signature', passed: true });

      const scope = payload.signature_kind === 'provider_tee' ? 'model' : 'gateway';
      const matches = (input.preflight.verifiedSigners ?? []).filter(
        (signer) => signer.scope === scope && signer.algorithm === payload.signing_algo && signer.address.toLowerCase() === payload.signing_address!.toLowerCase(),
      );
      if (matches.length !== 1) throw new Error('response signer does not uniquely match verified preflight evidence');
      checks.push({ name: `${scope} signer bound to verified quote`, passed: true });
      return { verified: true, checks, signatureKind: payload.signature_kind, signer: payload.signing_address, signingAlgorithm: payload.signing_algo };
    } catch (error) {
      checks.push({ name: 'response verification policy', passed: false, detail: (error as Error).message });
      return { verified: false, checks };
    }
  }

  private async verifyReport(report: NearReport, nonce: string, requireGpu: boolean, checks: EvidenceCheck[]): Promise<void> {
    if (!report || !/^[0-9a-f]{64}$/i.test(nonce)) throw new Error('invalid report or nonce');
    if (report.request_nonce?.toLowerCase() !== nonce.toLowerCase()) throw new Error('echoed nonce does not match');
    const identity = hexBytes(report.signing_address);
    if ({ ecdsa: 20, ed25519: 32 }[report.signing_algo] !== identity.length) throw new Error('unsupported signing identity');

    const verified = await this.quoteVerifier(hexBytes(report.intel_quote));
    if (!this.acceptedTcbStatuses.has(verified.status)) {
      throw new Error(`TCB status ${verified.status} not accepted: ${verified.advisory_ids.join(',')}`);
    }
    if (verified.report.type !== 'td10') throw new Error('expected a TDX 1.0 quote');
    const quote = verified.report.asTd10();
    if (!quote) throw new Error('TDX quote body is unavailable');
    if (quote.tdAttributes[0]! & 1) throw new Error('TDX debug mode is enabled');
    checks.push({ name: `Intel TDX quote (${verified.status})`, passed: true });

    const fingerprint = report.tls_cert_fingerprint;
    const boundIdentity = fingerprint
      ? digest('sha256', identity, hexBytes(fingerprint))
      : Buffer.concat([identity, Buffer.alloc(32 - identity.length)]);
    const expectedReportData = Buffer.concat([boundIdentity, hexBytes(nonce)]);
    if (!Buffer.from(quote.reportData).equals(expectedReportData)) throw new Error('report data does not bind signer and nonce');
    checks.push({ name: 'fresh nonce and signer binding', passed: true });

    const tcb = typeof report.info?.tcb_info === 'string' ? JSON.parse(report.info.tcb_info) : report.info?.tcb_info;
    const appCompose = tcb?.app_compose;
    if (typeof appCompose !== 'string') throw new Error('measured app_compose is missing');
    const expectedConfig = Buffer.concat([Buffer.from([1]), digest('sha256', Buffer.from(appCompose, 'utf8')), Buffer.alloc(15)]);
    if (!Buffer.from(quote.mrConfigId).equals(expectedConfig)) throw new Error('MRCONFIGID does not match app_compose');
    checks.push({ name: 'measured application configuration', passed: true });

    if (!replayRtmr3(report.event_log).equals(Buffer.from(quote.rtMr3))) throw new Error('event log does not match RTMR3');
    checks.push({ name: 'RTMR3 event-log replay', passed: true });

    if (requireGpu) {
      if (!report.nvidia_payload) throw new Error('model GPU evidence is missing');
      const gpuPayload = JSON.parse(report.nvidia_payload) as { nonce?: string };
      if (gpuPayload.nonce?.toLowerCase() !== nonce.toLowerCase()) throw new Error('GPU evidence nonce mismatch');
      const response = await this.fetcher('https://nras.attestation.nvidia.com/v3/attest/gpu', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(gpuPayload),
      });
      if (!response.ok) throw new Error(`NVIDIA NRAS failed (${response.status})`);
      const body = await response.json() as unknown;
      const jwt = Array.isArray(body) && Array.isArray(body[0]) ? body[0][1] : undefined;
      if (typeof jwt !== 'string') throw new Error('malformed NVIDIA attestation response');
      const jwtPayload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { 'x-nvidia-overall-att-result'?: unknown };
      if (jwtPayload['x-nvidia-overall-att-result'] !== true) throw new Error('NVIDIA GPU attestation did not pass');
      checks.push({ name: 'NVIDIA GPU attestation', passed: true });
    }
  }
}

export function replayRtmr3(raw: string | EventLogEntry[]): Buffer {
  const events = typeof raw === 'string' ? JSON.parse(raw) as EventLogEntry[] : raw;
  if (!Array.isArray(events)) throw new Error('event log is malformed');
  let rtmr3 = Buffer.alloc(48);
  for (const event of events) {
    if (event.imr !== 3) continue;
    if (!Number.isSafeInteger(event.event_type) || typeof event.event !== 'string') throw new Error('event log entry is malformed');
    const eventType = Buffer.alloc(4);
    eventType.writeUInt32LE(event.event_type);
    const eventDigest = digest('sha384', eventType, Buffer.from(':'), Buffer.from(event.event, 'utf8'), Buffer.from(':'), hexBytes(event.event_payload ?? ''));
    if (event.digest && !hexBytes(event.digest).equals(eventDigest)) throw new Error(`digest mismatch for event ${event.event}`);
    rtmr3 = digest('sha384', rtmr3, eventDigest);
  }
  return rtmr3;
}

const hexBytes = (value: string): Buffer => {
  const hex = value?.replace(/^0x/i, '');
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('invalid hexadecimal evidence');
  return Buffer.from(hex, 'hex');
};

function digest(algorithm: 'sha256' | 'sha384', ...parts: Uint8Array[]): Buffer {
  const hash = createHash(algorithm);
  for (const part of parts) hash.update(part);
  return hash.digest();
}
