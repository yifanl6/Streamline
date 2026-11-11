import type { SignedEnvelope } from './canonical';
import { sha256 } from './canonical';
import type { ReputationEvent, WorkReceiptBody } from './models';
import { verifyWorkReceipt } from './receipts';

export type ContributorTier = 'new' | 'proven' | 'trusted' | 'steward';
export class ReputationError extends Error {}

export class ReputationLedger {
  private readonly events = new Map<string, ReputationEvent>();

  constructor(private readonly trustedReceiptKeys: ReadonlySet<string>) {}

  recordCompleted(
    receipt: SignedEnvelope<WorkReceiptBody>,
    options: { onTime?: boolean; independentlyReviewed?: boolean; at?: number } = {},
  ): ReputationEvent[] {
    const body = verifyWorkReceipt(receipt, this.trustedReceiptKeys);
    if (body.review.decision !== 'pass') throw new ReputationError('failed work cannot earn reputation');
    const at = options.at ?? Date.now();
    const specs: Array<[ReputationEvent['kind'], number]> = [['completed', 10]];
    if (options.onTime) specs.push(['on_time', 3]);
    if (options.independentlyReviewed) specs.push(['independent_review', 2]);
    return specs.map(([kind, points]) => this.add(body, kind, points, at));
  }

  penalize(receipt: SignedEnvelope<WorkReceiptBody>, kind: 'rejected' | 'refund', at = Date.now()): ReputationEvent {
    const body = verifyWorkReceipt(receipt, this.trustedReceiptKeys);
    return this.add(body, kind, kind === 'rejected' ? -10 : -5, at);
  }

  score(accountId: string): number {
    return [...this.events.values()].filter((event) => event.accountId === accountId).reduce((sum, event) => sum + event.points, 0);
  }

  tier(accountId: string): ContributorTier {
    const score = this.score(accountId);
    return score >= 100 ? 'steward' : score >= 40 ? 'trusted' : score >= 10 ? 'proven' : 'new';
  }

  history(accountId: string): ReputationEvent[] {
    return [...this.events.values()].filter((event) => event.accountId === accountId).sort((a, b) => a.at - b.at);
  }

  private add(body: WorkReceiptBody, kind: ReputationEvent['kind'], points: number, at: number): ReputationEvent {
    const id = sha256({ receiptId: body.id, kind });
    const existing = this.events.get(id);
    if (existing) return existing;
    const event: ReputationEvent = {
      version: 1,
      id,
      accountId: body.contributor,
      daoId: body.daoId,
      bountyId: body.bountyId,
      receiptId: body.id,
      kind,
      points,
      at,
    };
    this.events.set(id, event);
    return event;
  }
}
