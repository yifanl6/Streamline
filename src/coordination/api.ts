import crypto, { type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { TaskBudget } from './budget';
import { CapabilityGuard, validateCapability } from './capability';
import {
  generateSigningKeys,
  importPrivateKey,
  publicKeyString,
  signEnvelope,
  type SignedEnvelope,
} from './canonical';
import type { AgentQuote, ProgramBudget, TaskCapability, WorkReceiptBody } from './models';
import { PaymentPolicyEngine, CounterpartyRegistry, type CounterpartyReport } from './policy';
import { SellerQuoteBook, negotiateOnce, type QuoteRequest } from './quotes';
import { issueWorkReceipt, type ReceiptInput } from './receipts';
import { ReputationLedger } from './reputation';
import { SputnikClient } from '../near/sputnik';
import type { NearAiPrivateReviewer } from '../privacy/near-ai';

export interface ApiOptions {
  adminToken: string;
  signingKey?: KeyObject;
  trustedReporters?: string[];
  daoId?: string;
  nearRpcUrl?: string;
  privateReviewer?: NearAiPrivateReviewer;
}

interface StoredTask {
  id: string;
  programId: string;
  title: string;
  contributor: string | null;
  status: 'open' | 'claimed' | 'completed' | 'rejected';
  createdAt: number;
}

export function createCoordinationApp(options: ApiOptions) {
  if (!options.adminToken) throw new Error('adminToken is required');
  const privateKey = options.signingKey ?? generateSigningKeys().privateKey;
  const coordinatorPublicKey = publicKeyString(privateKey);
  const trustedCoordinator = new Set([coordinatorPublicKey]);
  const budgets = new Map<string, TaskBudget>();
  const tasks = new Map<string, StoredTask>();
  const acceptedQuotes = new Map<string, SignedEnvelope<AgentQuote>>();
  const capabilityGuard = new CapabilityGuard(trustedCoordinator);
  const counterparties = new CounterpartyRegistry(new Set(options.trustedReporters ?? ['streamline-security']));
  const policy = new PaymentPolicyEngine(counterparties, capabilityGuard);
  const reputation = new ReputationLedger(trustedCoordinator);
  const dao = options.daoId ? new SputnikClient(options.daoId, options.nearRpcUrl) : null;
  const dashboardPath = path.resolve('src/coordination/dashboard.html');
  const dashboardTemplate = readFileSync(dashboardPath, 'utf8');
  const healthSnapshot = () => ({
    ok: true,
    service: 'streamline-coordination',
    coordinatorPublicKey,
    daoId: options.daoId ?? null,
    privateReviewConfigured: Boolean(options.privateReviewer),
  });
  const boardSnapshot = () => ({
    tasks: [...tasks.values()],
    budgets: [...budgets.values()].map((budget) => budget.snapshot()),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('cache-control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (_req, res) => {
    const bootstrap = JSON.stringify({ health: healthSnapshot(), board: boardSnapshot() }).replace(/</g, '\\u003c');
    res.type('html').send(dashboardTemplate.replace('</head>', `<script>window.__STREAMLINE_BOOTSTRAP__=${bootstrap}</script></head>`));
  });
  app.get('/health', (_req, res) => res.json(healthSnapshot()));

  app.get('/v1/board', (_req, res) => res.json(boardSnapshot()));

  app.post('/v1/programs', requireAdmin(options.adminToken), (req, res) => {
    const program = req.body as ProgramBudget;
    if (budgets.has(program.id)) return res.status(409).json({ error: 'program already exists' });
    const budget = new TaskBudget(program);
    budgets.set(program.id, budget);
    res.status(201).json(budget.snapshot());
  });

  app.post('/v1/tasks', requireAdmin(options.adminToken), (req, res) => {
    const { programId, title } = req.body as { programId?: string; title?: string };
    if (!programId || !budgets.has(programId)) return res.status(400).json({ error: 'unknown program' });
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const task: StoredTask = { id: crypto.randomUUID(), programId, title: title.trim(), contributor: null, status: 'open', createdAt: Date.now() };
    tasks.set(task.id, task);
    res.status(201).json(task);
  });

  app.post('/v1/tasks/:id/claim', requireAdmin(options.adminToken), (req, res) => {
    const task = tasks.get(req.params.id);
    const accountId = req.body?.accountId as string | undefined;
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (task.status !== 'open') return res.status(409).json({ error: 'task is not open' });
    if (!accountId || !/^[a-z0-9._-]{2,64}$/.test(accountId)) return res.status(400).json({ error: 'valid named account is required' });
    task.status = 'claimed';
    task.contributor = accountId;
    res.json(task);
  });

  app.post('/v1/capabilities', requireAdmin(options.adminToken), (req, res) => {
    const capability = req.body as TaskCapability;
    validateCapability(capability);
    const budget = budgets.get(capability.programId);
    const task = tasks.get(capability.taskId);
    if (!budget || !task || task.programId !== capability.programId) return res.status(400).json({ error: 'capability must reference an existing task and program' });
    const program = budget.program;
    if (capability.network !== program.network || capability.asset !== program.asset) return res.status(400).json({ error: 'capability payment rail differs from program' });
    if (capability.expiresAt > program.expiresAt) return res.status(400).json({ error: 'capability outlives its program' });
    if (BigInt(capability.maxTotal) > budget.remaining) return res.status(400).json({ error: 'capability exceeds remaining program budget' });
    if (!capability.allowedPayees.every((payee) => program.allowedPayees.includes(payee))) return res.status(400).json({ error: 'capability expands the program payee list' });
    res.status(201).json(signEnvelope(capability, privateKey));
  });

  app.post('/v1/security/reports', requireAdmin(options.adminToken), (req, res) => {
    counterparties.add(req.body as CounterpartyReport);
    res.status(201).json({ accepted: true });
  });

  app.post('/v1/security/authorize', requireAdmin(options.adminToken), (req, res) => {
    const { capability, use, humanApprovedWarning } = req.body as {
      capability: SignedEnvelope<TaskCapability>;
      use: Omit<Parameters<PaymentPolicyEngine['authorize']>[1], 'amount'> & { amount: string | bigint };
      humanApprovedWarning?: boolean;
    };
    const normalizedUse = { ...use, amount: BigInt(use.amount) };
    const decision = policy.authorize(capability, normalizedUse, { humanApprovedWarning });
    res.json({ authorized: true, decision, usage: capabilityGuard.usageFor(capability.payload.id) });
  });

  app.post('/v1/negotiate', requireAdmin(options.adminToken), (req, res) => {
    const { request, seller, listPrice, minimumPrice, plannedPrice, maxPrice } = req.body as {
      request: QuoteRequest;
      seller: string;
      listPrice: string;
      minimumPrice: string;
      plannedPrice: string;
      maxPrice: string;
    };
    const quoteBook = new SellerQuoteBook(seller, privateKey, BigInt(listPrice), BigInt(minimumPrice));
    const result = negotiateOnce(request, quoteBook, BigInt(plannedPrice), BigInt(maxPrice));
    if (result.quote) acceptedQuotes.set(result.quote.payload.id, result.quote);
    res.json(result);
  });

  app.post('/v1/programs/:id/reservations', requireAdmin(options.adminToken), (req, res) => {
    const budget = requiredBudget(budgets, req.params.id);
    const id = budget.reserve(BigInt(req.body.amount), req.body.payee, req.body.service);
    res.status(201).json({ id, budget: budget.snapshot() });
  });

  app.post('/v1/programs/:id/reservations/:reservation/settle', requireAdmin(options.adminToken), (req, res) => {
    const budget = requiredBudget(budgets, req.params.id);
    budget.settle(req.params.reservation, req.body.transaction);
    res.json(budget.snapshot());
  });

  app.post('/v1/programs/:id/reservations/:reservation/release', requireAdmin(options.adminToken), (req, res) => {
    const budget = requiredBudget(budgets, req.params.id);
    budget.release(req.params.reservation);
    res.json(budget.snapshot());
  });

  app.post('/v1/receipts', requireAdmin(options.adminToken), (req, res) => {
    const input = req.body as ReceiptInput;
    const task = tasks.get(input.taskId);
    const budget = budgets.get(input.programId);
    if (!task || !budget || task.programId !== input.programId) return res.status(400).json({ error: 'receipt must reference an existing task and program' });
    if (input.daoId !== budget.program.daoId || input.bountyId !== budget.program.bountyId) return res.status(400).json({ error: 'receipt DAO or bounty does not match program' });
    if (task.contributor !== input.contributor) return res.status(400).json({ error: 'receipt contributor did not claim the task' });
    for (const payment of input.payments) {
      const quote = acceptedQuotes.get(payment.quoteId)?.payload;
      if (!quote || quote.taskId !== input.taskId) return res.status(400).json({ error: `payment references unknown quote ${payment.quoteId}` });
      if (quote.seller !== payment.payee || quote.network !== payment.network || quote.asset !== payment.asset || quote.amount !== payment.amount) {
        return res.status(400).json({ error: `payment does not match negotiated quote ${payment.quoteId}` });
      }
    }
    res.status(201).json(issueWorkReceipt(input, privateKey));
  });

  app.post('/v1/reputation/completed', requireAdmin(options.adminToken), (req, res) => {
    const { receipt, onTime, independentlyReviewed } = req.body as {
      receipt: SignedEnvelope<WorkReceiptBody>;
      onTime?: boolean;
      independentlyReviewed?: boolean;
    };
    const accountId = receipt.payload.contributor;
    const task = tasks.get(receipt.payload.taskId);
    if (!task || task.status !== 'claimed' || task.contributor !== accountId) return res.status(409).json({ error: 'task is not claimed by receipt contributor' });
    const events = reputation.recordCompleted(receipt, { onTime, independentlyReviewed });
    task.status = 'completed';
    res.status(201).json({ events, score: reputation.score(accountId), tier: reputation.tier(accountId) });
  });

  app.get('/v1/reputation/:accountId', (req, res) => {
    res.json({ accountId: req.params.accountId, score: reputation.score(req.params.accountId), tier: reputation.tier(req.params.accountId), history: reputation.history(req.params.accountId) });
  });

  app.get('/v1/dao', async (_req, res) => {
    if (!dao) return res.status(503).json({ error: 'DAO adapter is not configured' });
    const [policy, bounties, proposals] = await Promise.all([dao.getPolicy(), dao.getBounties(), dao.getProposals()]);
    res.json({ daoId: dao.daoId, policy, bounties, proposals });
  });

  app.post('/v1/dao/actions/add-bounty', requireAdmin(options.adminToken), async (req, res) => {
    if (!dao) return res.status(503).json({ error: 'DAO adapter is not configured' });
    if (!req.body.description?.trim() || !req.body.bounty || typeof req.body.bounty !== 'object') return res.status(400).json({ error: 'description and bounty are required' });
    const policy = await dao.getPolicy();
    res.json(dao.addBountyProposal(req.body.description, req.body.bounty, policy.proposal_bond));
  });

  app.post('/v1/dao/actions/claim-bounty', requireAdmin(options.adminToken), async (req, res) => {
    if (!dao) return res.status(503).json({ error: 'DAO adapter is not configured' });
    const id = nonnegativeInteger(req.body.id, 'bounty id');
    if (!/^[0-9]+$/.test(String(req.body.deadline))) return res.status(400).json({ error: 'deadline must be an integer string' });
    const policy = await dao.getPolicy();
    res.json(dao.claimBounty(id, String(req.body.deadline), policy.bounty_bond));
  });

  app.post('/v1/dao/actions/complete-bounty', requireAdmin(options.adminToken), (req, res) => {
    if (!dao) return res.status(503).json({ error: 'DAO adapter is not configured' });
    const id = nonnegativeInteger(req.body.id, 'bounty id');
    if (!/^[a-z0-9._-]{2,64}$/.test(req.body.accountId ?? '') || !req.body.description?.trim()) return res.status(400).json({ error: 'valid accountId and description are required' });
    res.json(dao.completeBounty(id, req.body.accountId, req.body.description));
  });

  app.post('/v1/dao/actions/vote', requireAdmin(options.adminToken), (req, res) => {
    if (!dao) return res.status(503).json({ error: 'DAO adapter is not configured' });
    const proposalId = nonnegativeInteger(req.body.proposalId, 'proposal id');
    if (!['VoteApprove', 'VoteReject', 'VoteRemove'].includes(req.body.action)) return res.status(400).json({ error: 'invalid vote action' });
    res.json(dao.vote(proposalId, req.body.action));
  });

  app.post('/v1/private-review', requireAdmin(options.adminToken), async (req, res) => {
    if (!options.privateReviewer) return res.status(503).json({ error: 'NEAR AI private reviewer is not configured' });
    const { criteria, deliverable } = req.body as { criteria?: string; deliverable?: string };
    if (!criteria?.trim() || !deliverable?.trim()) return res.status(400).json({ error: 'criteria and deliverable are required' });
    // The reviewer returns only hashes, verdict, and evidence checks; plaintext is not stored.
    res.json(await options.privateReviewer.review(criteria, deliverable));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    res.status(400).json({ error: message });
  });
  return app;
}

function requiredBudget(budgets: Map<string, TaskBudget>, id: string): TaskBudget {
  const budget = budgets.get(id);
  if (!budget) throw new Error('program not found');
  return budget;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a nonnegative integer`);
  return parsed;
}

function requireAdmin(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'admin authorization required' });
    next();
  };
}

export function loadApiSigningKey(): KeyObject | undefined {
  const seed = process.env.STREAMLINE_SIGNING_SEED;
  if (seed) {
    const seedBytes = Buffer.from(seed, 'base64');
    if (seedBytes.length !== 32) throw new Error('STREAMLINE_SIGNING_SEED must decode to exactly 32 bytes');
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    return crypto.createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seedBytes]), type: 'pkcs8', format: 'der' });
  }
  const encoded = process.env.STREAMLINE_SIGNING_KEY;
  if (!encoded || encoded.startsWith('replace-')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('STREAMLINE_SIGNING_SEED or STREAMLINE_SIGNING_KEY is required in production');
    }
    if (encoded) console.warn('[coordination] STREAMLINE_SIGNING_KEY is a placeholder; using an ephemeral demo key');
    return undefined;
  }
  try {
    return importPrivateKey(encoded);
  } catch {
    throw new Error('STREAMLINE_SIGNING_KEY is invalid; run npm run coordination:keygen and copy its STREAMLINE_SIGNING_KEY value into .env');
  }
}
