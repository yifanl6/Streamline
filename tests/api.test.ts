import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createCoordinationApp } from '../src/coordination/api';

test('coordination API exposes an authenticated shared-budget workflow', async (t) => {
  const app = createCoordinationApp({ adminToken: 'test-admin' });

  let unauthorized;
  try {
    unauthorized = await request(app).post('/v1/programs').send({});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('sandbox forbids loopback listeners; run outside the sandbox to exercise HTTP transport');
      return;
    }
    throw error;
  }
  assert.equal(unauthorized.status, 401);
  const dashboard = await request(app).get('/');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Coordinate value\. Prove the work\./);

  const program = {
    version: 1, id: 'p1', daoId: 'dao.sputnik-dao.testnet', bountyId: 1, asset: 'USDC', network: 'monad-testnet',
    total: '10000', expiresAt: Date.now() + 60_000, allowedServices: ['risk'], allowedPayees: ['data-agent'],
  };
  const created = await request(app).post('/v1/programs').set('authorization', 'Bearer test-admin').send(program);
  assert.equal(created.status, 201);
  const taskResponse = await request(app).post('/v1/tasks').set('authorization', 'Bearer test-admin').send({ programId: 'p1', title: 'Review account' });
  assert.equal(taskResponse.status, 201);
  const task = taskResponse.body as { id: string };
  const claim = await request(app).post(`/v1/tasks/${task.id}/claim`).set('authorization', 'Bearer test-admin').send({ accountId: 'alice.testnet' });
  assert.equal(claim.status, 200);

  const quoteResponse = await request(app).post('/v1/negotiate').set('authorization', 'Bearer test-admin').send({
    request: { taskId: task.id, resource: 'https://data.example/account/alice', method: 'GET', network: 'monad-testnet', asset: 'USDC' },
    seller: 'data-agent', listPrice: '7000', minimumPrice: '5000', plannedPrice: '5000', maxPrice: '6000',
  });
  assert.equal(quoteResponse.body.outcome, 'accepted');
  assert.equal(quoteResponse.body.countered, true);
  const quote = quoteResponse.body.quote as { payload: { id: string; amount: string } };

  const now = Date.now();
  const capabilityResponse = await request(app).post('/v1/capabilities').set('authorization', 'Bearer test-admin').send({
    version: 1, id: 'cap-api', programId: 'p1', taskId: task.id, subject: 'analyst-agent', network: 'monad-testnet', asset: 'USDC',
    allowedPayees: ['data-agent'], allowedMethods: ['GET'], allowedResourcePrefixes: ['https://data.example/account/'],
    maxPerCall: '5000', maxTotal: '5000', maxCalls: 1, notBefore: now - 1000, expiresAt: now + 30_000, delegationDepth: 0,
  });
  assert.equal(capabilityResponse.status, 201);
  const authorization = await request(app).post('/v1/security/authorize').set('authorization', 'Bearer test-admin').send({
    capability: capabilityResponse.body,
    use: { subject: 'analyst-agent', network: 'monad-testnet', asset: 'USDC', payee: 'data-agent', method: 'GET', resource: 'https://data.example/account/alice', amount: '5000' },
  });
  assert.equal(authorization.status, 200);
  assert.deepEqual(authorization.body.usage, { calls: 1, spent: '5000' });

  const reservation = await request(app).post('/v1/programs/p1/reservations').set('authorization', 'Bearer test-admin').send({ amount: '5000', payee: 'data-agent', service: 'risk' });
  assert.equal(reservation.status, 201);
  const reservationBody = reservation.body as { id: string };
  const settled = await request(app).post(`/v1/programs/p1/reservations/${reservationBody.id}/settle`).set('authorization', 'Bearer test-admin').send({ transaction: '0xtx' });
  const settledBody = settled.body as { spent: string; remaining: string };
  assert.deepEqual({ spent: settledBody.spent, remaining: settledBody.remaining }, { spent: '5000', remaining: '5000' });

  const receiptResponse = await request(app).post('/v1/receipts').set('authorization', 'Bearer test-admin').send({
    version: 1, daoId: program.daoId, bountyId: 1, programId: 'p1', taskId: task.id, contributor: 'alice.testnet',
    requestHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64), algorithm: 'risk-v1',
    startedAt: now, completedAt: now + 1000,
    payments: [{ network: 'monad-testnet', asset: 'USDC', payer: 'analyst-agent', payee: 'data-agent', amount: quote.payload.amount, transaction: '0xtx', quoteId: quote.payload.id }],
    review: { decision: 'pass', reviewer: 'near-ai-cloud', attestationHash: 'd'.repeat(64) },
  });
  assert.equal(receiptResponse.status, 201);
  const reputation = await request(app).post('/v1/reputation/completed').set('authorization', 'Bearer test-admin').send({
    receipt: receiptResponse.body, onTime: true, independentlyReviewed: true,
  });
  assert.deepEqual({ score: reputation.body.score, tier: reputation.body.tier }, { score: 15, tier: 'proven' });

  const board = (await request(app).get('/v1/board')).body as { tasks: unknown[]; budgets: unknown[] };
  assert.equal(board.tasks.length, 1);
  assert.equal(board.budgets.length, 1);
});
