import type { KeyObject } from 'node:crypto';
import { sha256, signEnvelope, verifyEnvelope, type SignedEnvelope } from './canonical';
import { parseAmount } from './budget';
import type { WorkReceiptBody } from './models';

export class ReceiptError extends Error {}
export type ReceiptInput = Omit<WorkReceiptBody, 'id' | 'totalSpent'> & { totalSpent?: string };

export function issueWorkReceipt(input: ReceiptInput, privateKey: KeyObject): SignedEnvelope<WorkReceiptBody> {
  const total = input.payments.reduce((sum, payment) => sum + parseAmount(payment.amount), 0n);
  if (input.totalSpent !== undefined && BigInt(input.totalSpent) !== total) throw new ReceiptError('declared total does not match payments');
  const withoutId = { ...input, totalSpent: total.toString() };
  const body: WorkReceiptBody = { ...withoutId, id: sha256(withoutId) };
  validateReceiptBody(body);
  return signEnvelope(body, privateKey);
}

export function verifyWorkReceipt(
  receipt: SignedEnvelope<WorkReceiptBody>,
  trustedKeys?: ReadonlySet<string>,
): WorkReceiptBody {
  if (!verifyEnvelope(receipt, trustedKeys)) throw new ReceiptError('invalid or untrusted receipt signature');
  validateReceiptBody(receipt.payload);
  const { id, ...withoutId } = receipt.payload;
  if (sha256(withoutId) !== id) throw new ReceiptError('receipt id does not match its contents');
  return receipt.payload;
}

function validateReceiptBody(body: WorkReceiptBody): void {
  if (body.version !== 1 || !body.id || !body.daoId || !body.programId || !body.taskId || !body.contributor) {
    throw new ReceiptError('malformed receipt identity');
  }
  if (!/^[0-9a-f]{64}$/.test(body.requestHash) || !/^[0-9a-f]{64}$/.test(body.inputHash) || !/^[0-9a-f]{64}$/.test(body.outputHash)) {
    throw new ReceiptError('receipt hashes must be SHA-256 hex');
  }
  if (body.completedAt < body.startedAt) throw new ReceiptError('receipt completes before it starts');
  const quoteIds = new Set<string>();
  let total = 0n;
  for (const payment of body.payments) {
    if (!payment.transaction || !payment.payer || !payment.payee || !payment.quoteId) throw new ReceiptError('malformed payment evidence');
    if (quoteIds.has(payment.quoteId)) throw new ReceiptError('duplicate quote payment');
    quoteIds.add(payment.quoteId);
    total += parseAmount(payment.amount);
  }
  if (total !== parseAmount(body.totalSpent, 'totalSpent')) throw new ReceiptError('payment total mismatch');
  if (body.review.decision === 'pass' && !body.review.reviewer) throw new ReceiptError('passing review requires reviewer');
}
