import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { SputnikClient } from '../src/near/sputnik';
import { DcapNearAiEvidenceVerifier, replayRtmr3 } from '../src/privacy/dcap-verifier';
import { FailClosedEvidenceVerifier, NearAiPrivateReviewer, type NearAiEvidenceVerifier } from '../src/privacy/near-ai';

test('Sputnik adapter sends final view queries and builds wallet-signable bounty actions', async () => {
  const calls: any[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    const bytes = [...Buffer.from(JSON.stringify([{ id: 3, description: 'Research', token: '', amount: '10', times: 1, max_deadline: '1000' }]))];
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { result: bytes } }), { status: 200 });
  };
  const client = new SputnikClient('streamline.sputnik-dao.testnet', 'https://rpc.testnet.near.org', fetcher);
  const bounties = await client.getBounties(0, 10);
  assert.equal(bounties[0].description, 'Research');
  assert.equal(calls[0].params.finality, 'final');
  assert.equal(calls[0].params.method_name, 'get_bounties');
  const claim = client.claimBounty(3, '1000000000', '100');
  assert.deepEqual(claim.args, { id: 3, deadline: '1000000000' });
  assert.equal(claim.receiverId, 'streamline.sputnik-dao.testnet');
  assert.equal(client.completeBounty(3, 'alice.testnet', 'receipt:abc').methodName, 'bounty_done');
});

test('private reviewer verifies preflight before inference and returns only hashes and verdict', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/attestation/report')) return new Response(JSON.stringify({ gateway_attestation: {}, model_attestations: [{}] }));
    if (url.includes('/chat/completions')) return new Response(JSON.stringify({ id: 'chat-1', choices: [{ message: { content: '{"decision":"pass","reasons":["meets criteria"]}' } }] }));
    if (url.includes('/signature/')) return new Response(JSON.stringify({ signature_kind: 'provider_tee', text: 'signed', signature: '0xabc' }));
    throw new Error('unexpected URL');
  };
  const verifier: NearAiEvidenceVerifier = {
    async verifyPreflight(_report, nonce) {
      assert.match(nonce, /^[0-9a-f]{64}$/);
      return { verified: true, signer: '0xtee', signingAlgorithm: 'ecdsa', checks: [{ name: 'DCAP quote', passed: true }] };
    },
    async verifyResponse(input) {
      assert.match(input.requestHash, /^[0-9a-f]{64}$/);
      assert.match(input.responseHash, /^[0-9a-f]{64}$/);
      return { verified: true, signatureKind: 'provider_tee', checks: [{ name: 'response signature', passed: true }] };
    },
  };
  const result = await new NearAiPrivateReviewer('secret', verifier, 'model-id', 'https://cloud.example/v1', fetcher).review('must be correct', 'fictional deliverable');
  assert.equal(result.decision, 'pass');
  assert.equal('deliverable' in result, false);
  assert.equal(calls.length, 3);
});

test('private reviewer fails closed and never calls inference when attestation is not cryptographically verified', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ gateway_attestation: { request_nonce: 'echo-only' } }));
  };
  const reviewer = new NearAiPrivateReviewer('secret', new FailClosedEvidenceVerifier(), 'model-id', 'https://cloud.example/v1', fetcher);
  await assert.rejects(() => reviewer.review('criteria', 'private text'), /did not verify/);
  assert.equal(calls, 1);
});

test('DCAP verifier binds quote measurements, nonce, GPU verdict, and exact signed response hashes', async () => {
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const nonce = 'ab'.repeat(32);
  const appCompose = '{"docker_compose_file":"services: {}"}';
  const eventLog = [{ imr: 3, event_type: 1, event: 'compose-hash', event_payload: 'cafe' }];
  const identity = Buffer.from(account.address.slice(2), 'hex');
  const reportData = Buffer.concat([identity, Buffer.alloc(12), Buffer.from(nonce, 'hex')]);
  const mrConfigId = Buffer.concat([Buffer.from([1]), createHash('sha256').update(appCompose).digest(), Buffer.alloc(15)]);
  const quoteBody = { tdAttributes: Buffer.alloc(8), reportData, mrConfigId, rtMr3: replayRtmr3(eventLog) };
  const quoteVerifier = async () => ({
    status: 'UpToDate', advisory_ids: [], report: { type: 'td10', asTd10: () => quoteBody },
  }) as any;
  const gpuJwt = `x.${Buffer.from(JSON.stringify({ 'x-nvidia-overall-att-result': true })).toString('base64url')}.y`;
  const fetcher: typeof fetch = async () => new Response(JSON.stringify([['JWT', gpuJwt]]));
  const verifier = new DcapNearAiEvidenceVerifier(new Set(['UpToDate']), quoteVerifier, fetcher);
  const base = {
    intel_quote: '00', event_log: eventLog, request_nonce: nonce, signing_address: account.address,
    signing_algo: 'ecdsa', info: { tcb_info: { app_compose: appCompose } },
  };
  const preflight = await verifier.verifyPreflight({
    gateway_attestation: base,
    model_attestations: [{ ...base, nvidia_payload: JSON.stringify({ nonce }) }],
  }, nonce, 'model-id');
  assert.equal(preflight.verified, true);
  assert.equal(preflight.checks.every((check) => check.passed), true);

  const requestHash = 'a'.repeat(64);
  const responseHash = 'b'.repeat(64);
  const text = `model-id:${requestHash}:${responseHash}`;
  const signature = await account.signMessage({ message: text });
  const response = await verifier.verifyResponse({
    signature: { signature_kind: 'provider_tee', text, signature, signing_address: account.address, signing_algo: 'ecdsa' },
    preflight, model: 'model-id', requestHash, responseHash,
  });
  assert.equal(response.verified, true);
  const tampered = await verifier.verifyResponse({
    signature: { signature_kind: 'provider_tee', text, signature, signing_address: account.address, signing_algo: 'ecdsa' },
    preflight, model: 'model-id', requestHash, responseHash: 'c'.repeat(64),
  });
  assert.equal(tampered.verified, false);
});
