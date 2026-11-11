import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { X402Client } from '../src/monad/client';
import type { PaymentRequiredResponse } from '../src/monad/x402';

test('Monad x402 client invokes policy hook after quote validation but before signing or paid retry', async (t) => {
  const buyer = privateKeyToAccount(`0x${'22'.repeat(32)}`);
  const seller = privateKeyToAccount(`0x${'33'.repeat(32)}`);
  const token = privateKeyToAccount(`0x${'44'.repeat(32)}`).address;
  const challenge: PaymentRequiredResponse = {
    x402Version: 1,
    accepts: [{
      scheme: 'exact', network: 'monad-testnet', maxAmountRequired: '5000', resource: 'https://seller.example/data',
      description: 'data', mimeType: 'application/json', payTo: seller.address, maxTimeoutSeconds: 60, asset: token,
      extra: { name: 'Test USD', version: '1', nonce: `0x${'55'.repeat(32)}` },
    }],
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify(challenge), { status: 402, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  let guardCalls = 0;
  const client = new X402Client(buyer, {
    network: 'monad-testnet', asset: token, maxPerCall: 5000n, budget: 5000n, allowedPayees: [seller.address],
  }, () => {
    guardCalls++;
    throw new Error('blocked before signing');
  });

  await assert.rejects(() => client.get('https://seller.example/data'), /blocked before signing/);
  assert.equal(guardCalls, 1);
  assert.equal(fetchCalls, 1, 'no paid retry was sent');
  assert.equal(client.spent, 0n);
  assert.equal(client.remaining, 5000n, 'reservation was released');
});
