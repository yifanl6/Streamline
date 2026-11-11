export type Amount = string;
export type TaskStatus = 'open' | 'claimed' | 'in_progress' | 'review' | 'completed' | 'rejected';

export interface ProgramBudget {
  version: 1;
  id: string;
  daoId: string;
  bountyId: number;
  asset: string;
  network: string;
  total: Amount;
  expiresAt: number;
  allowedServices: string[];
  allowedPayees: string[];
}

export interface TaskCapability {
  version: 1;
  id: string;
  programId: string;
  taskId: string;
  subject: string;
  network: string;
  asset: string;
  allowedPayees: string[];
  allowedMethods: string[];
  allowedResourcePrefixes: string[];
  maxPerCall: Amount;
  maxTotal: Amount;
  maxCalls: number;
  notBefore: number;
  expiresAt: number;
  delegationDepth: number;
}

export interface AgentQuote {
  version: 1;
  id: string;
  taskId: string;
  seller: string;
  resource: string;
  method: string;
  network: string;
  asset: string;
  amount: Amount;
  issuedAt: number;
  expiresAt: number;
  round: 0 | 1;
}

export interface ReceiptPayment {
  network: string;
  asset: string;
  payer: string;
  payee: string;
  amount: Amount;
  transaction: string;
  quoteId: string;
}

export interface WorkReceiptBody {
  version: 1;
  id: string;
  daoId: string;
  bountyId: number;
  programId: string;
  taskId: string;
  contributor: string;
  requestHash: string;
  inputHash: string;
  outputHash: string;
  algorithm: string;
  startedAt: number;
  completedAt: number;
  payments: ReceiptPayment[];
  totalSpent: Amount;
  review: {
    decision: 'pass' | 'fail';
    reviewer: string;
    attestationHash: string | null;
  };
}

export interface ReputationEvent {
  version: 1;
  id: string;
  accountId: string;
  daoId: string;
  bountyId: number;
  receiptId: string;
  kind: 'completed' | 'on_time' | 'independent_review' | 'rejected' | 'refund';
  points: number;
  at: number;
}
