import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApiSigningKey } from '../src/coordination/api';
import { TaskBudget } from '../src/coordination/budget';
import { CapabilityGuard } from '../src/coordination/capability';
import { canonicalJson, generateSigningKeys, publicKeyString, sha256, signEnvelope, verifyEnvelope } from '../src/coordination/canonical';
import type { ProgramBudget, TaskCapability } from '../src/coordination/models';
import { CounterpartyRegistry, PaymentPolicyEngine } from '../src/coordination/policy';
import { SellerQuoteBook, negotiateOnce, verifyQuote } from '../src/coordination/quotes';
import { issueWorkReceipt, verifyWorkReceipt } from '../src/coordination/receipts';
import { ReputationLedger } from '../src/coordination/reputation';

const NOW = 1_800_000_000_000;
const program = (overrides: Partial<ProgramBudget> = {}): ProgramBudget => ({
  version: 1,
  id: 'program-1',
  daoId: 'streamline.sputnik-dao.testnet',
  bountyId: 7,
  asset: 'USDC',
  network: 'monad-testnet',
  total: '50000',
  expiresAt: NOW + 60_000,
  allowedServices: ['account-risk'],
  allowedPayees: ['data-agent'],
  ...overrides,
});

const capability = (overrides: Partial<TaskCapability> = {}): TaskCapability => ({
  version: 1,
  id: 'cap-1',
  programId: 'program-1',
  taskId: 'task-1',
  subject: 'analyst-agent',
  network: 'monad-testnet',
  asset: 'USDC',
  allowedPayees: ['data-agent'],
  allowedMethods: ['GET'],
  allowedResourcePrefixes: ['https://data.example/account/'],
  maxPerCall: '5000',
  maxTotal: '10000',
  maxCalls: 2,
  notBefore: NOW - 1000,
  expiresAt: NOW + 60_000,
  delegationDepth: 0,
  ...overrides,
});

test('canonical JSON, signatures, and hashes are deterministic and tamper evident', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
  const keys = generateSigningKeys();
  const signed = signEnvelope({ amount: '5000', task: 'one' }, keys.privateKey);
  assert.equal(verifyEnvelope(signed, new Set([signed.publicKey])), true);
  signed.payload.amount = '5001';
  assert.equal(verifyEnvelope(signed), false);
});

test('a hosted signing seed produces a stable Ed25519 coordinator identity', () => {
  const previousSeed = process.env.STREAMLINE_SIGNING_SEED;
  try {
    process.env.STREAMLINE_SIGNING_SEED = Buffer.alloc(32, 7).toString('base64');
    const first = loadApiSigningKey();
    const second = loadApiSigningKey();
    assert.ok(first && second);
    assert.equal(publicKeyString(first), publicKeyString(second));
  } finally {
    if (previousSeed === undefined) delete process.env.STREAMLINE_SIGNING_SEED;
    else process.env.STREAMLINE_SIGNING_SEED = previousSeed;
  }
});

test('shared budget reserves atomically, settles once, and releases failures', () => {
  const budget = new TaskBudget(program());
  const first = budget.reserve(30_000n, 'data-agent', 'account-risk', NOW);
  assert.throws(() => budget.reserve(25_000n, 'data-agent', 'account-risk', NOW), /exceeds remaining/);
  budget.settle(first, '0xtx');
  assert.equal(budget.spent, 30_000n);
  assert.throws(() => budget.settle(first, '0xagain'), /already settled/);
  const second = budget.reserve(10_000n, 'data-agent', 'account-risk', NOW);
  budget.release(second);
  assert.equal(budget.remaining, 20_000n);
  assert.throws(() => budget.reserve(1n, 'evil-agent', 'account-risk', NOW), /not allowed/);
});

test('capabilities enforce signer, subject, route, total, call count, and expiry', () => {
  const issuer = generateSigningKeys();
  const signed = signEnvelope(capability(), issuer.privateKey);
  const guard = new CapabilityGuard(new Set([signed.publicKey]));
  const use = {
    subject: 'analyst-agent', network: 'monad-testnet', asset: 'USDC', payee: 'data-agent',
    method: 'GET', resource: 'https://data.example/account/alice', amount: 5000n,
  };
  guard.authorize(signed, use, NOW);
  guard.authorize(signed, use, NOW);
  assert.deepEqual(guard.usageFor('cap-1'), { calls: 2, spent: '10000' });
  assert.throws(() => guard.authorize(signed, use, NOW), /call limit/);

  const wrongRoute = signEnvelope(capability({ id: 'cap-route' }), issuer.privateKey);
  assert.throws(() => guard.authorize(wrongRoute, { ...use, resource: 'https://evil.example/' }, NOW), /resource/);
  const expired = signEnvelope(capability({ id: 'cap-expired', expiresAt: NOW }), issuer.privateKey);
  assert.throws(() => guard.authorize(expired, use, NOW), /not currently valid/);
  const untrusted = signEnvelope(capability({ id: 'cap-evil' }), generateSigningKeys().privateKey);
  assert.throws(() => guard.authorize(untrusted, use, NOW), /untrusted/);
});

test('counterparty policy blocks before capability use and warns for human approval', () => {
  const issuer = generateSigningKeys();
  const signed = signEnvelope(capability(), issuer.privateKey);
  const guard = new CapabilityGuard(new Set([signed.publicKey]));
  const registry = new CounterpartyRegistry(new Set(['security-dao']));
  registry.add({ reporter: 'security-dao', payee: 'data-agent', severity: 'block', evidence: `sha256:${'a'.repeat(64)}`, reason: 'confirmed drain', expiresAt: NOW + 1000 });
  const engine = new PaymentPolicyEngine(registry, guard);
  const use = { subject: 'analyst-agent', network: 'monad-testnet', asset: 'USDC', payee: 'data-agent', method: 'GET', resource: 'https://data.example/account/alice', amount: 5000n };
  assert.throws(() => engine.authorize(signed, use, { now: NOW }), /blocked before signing/);
  assert.deepEqual(guard.usageFor('cap-1'), { calls: 0, spent: '0' });
  assert.throws(() => registry.add({ reporter: 'attacker', payee: 'x', severity: 'block', evidence: 'https://evidence', reason: 'fake', expiresAt: NOW + 1 }), /untrusted/);

  const warningCapability = signEnvelope(capability({ id: 'cap-warning' }), issuer.privateKey);
  const warningRegistry = new CounterpartyRegistry(new Set(['security-dao']));
  warningRegistry.add({ reporter: 'security-dao', payee: 'data-agent', severity: 'warn', evidence: 'https://evidence.example/report', reason: 'young account', expiresAt: NOW + 1000 });
  const warningEngine = new PaymentPolicyEngine(warningRegistry, guard);
  assert.throws(() => warningEngine.authorize(warningCapability, use, { now: NOW }), /human approval required/);
  assert.deepEqual(guard.usageFor('cap-warning'), { calls: 0, spent: '0' });
  assert.equal(warningEngine.authorize(warningCapability, use, { now: NOW, humanApprovedWarning: true }).verdict, 'warn');
  assert.deepEqual(guard.usageFor('cap-warning'), { calls: 1, spent: '5000' });
});

test('buyer counters once and verifies the seller-signed accepted quote', () => {
  const sellerKeys = generateSigningKeys();
  const request = { taskId: 'task-1', resource: 'https://data.example/account/alice', method: 'GET', network: 'monad-testnet', asset: 'USDC' };
  const seller = new SellerQuoteBook('data-agent', sellerKeys.privateKey, 7000n, 5000n);
  const result = negotiateOnce(request, seller, 5000n, 6000n, NOW);
  assert.equal(result.outcome, 'accepted');
  assert.equal(result.countered, true);
  assert.equal(result.quote?.payload.amount, '5000');
  verifyQuote(result.quote!, new Set([publicKeyString(sellerKeys.publicKey)]), request, NOW);
  assert.equal(negotiateOnce(request, seller, 4000n, 4500n, NOW).outcome, 'walked-away');
});

test('work receipts reconcile payments, reject tampering, and award idempotent reputation', () => {
  const keys = generateSigningKeys();
  const receipt = issueWorkReceipt({
    version: 1,
    daoId: 'streamline.sputnik-dao.testnet', bountyId: 7, programId: 'program-1', taskId: 'task-1', contributor: 'alice.testnet',
    requestHash: sha256('request'), inputHash: sha256('input'), outputHash: sha256('output'), algorithm: 'risk-v1',
    startedAt: NOW, completedAt: NOW + 1000,
    payments: [{ network: 'monad-testnet', asset: 'USDC', payer: 'analyst', payee: 'data', amount: '5000', transaction: '0xtx', quoteId: 'quote-1' }],
    review: { decision: 'pass', reviewer: 'near-ai-cloud', attestationHash: sha256('attestation') },
  }, keys.privateKey);
  assert.equal(verifyWorkReceipt(receipt).totalSpent, '5000');
  const ledger = new ReputationLedger(new Set([receipt.publicKey]));
  assert.equal(ledger.recordCompleted(receipt, { onTime: true, independentlyReviewed: true, at: NOW }).length, 3);
  assert.equal(ledger.recordCompleted(receipt, { onTime: true, independentlyReviewed: true, at: NOW + 1 }).length, 3);
  assert.equal(ledger.score('alice.testnet'), 15);
  assert.equal(ledger.tier('alice.testnet'), 'proven');
  receipt.payload.outputHash = sha256('tampered');
  assert.throws(() => verifyWorkReceipt(receipt), /signature/);
});
