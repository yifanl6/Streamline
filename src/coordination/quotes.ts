import { randomUUID, type KeyObject } from 'node:crypto';
import { signEnvelope, verifyEnvelope, type SignedEnvelope } from './canonical';
import { parseAmount } from './budget';
import type { AgentQuote } from './models';

export class QuoteError extends Error {}

export interface QuoteRequest {
  taskId: string;
  resource: string;
  method: string;
  network: string;
  asset: string;
}

export class SellerQuoteBook {
  constructor(
    private readonly seller: string,
    private readonly privateKey: KeyObject,
    private readonly listPrice: bigint,
    private readonly minimumPrice: bigint,
    private readonly ttlMs = 60_000,
  ) {
    if (minimumPrice <= 0n || listPrice < minimumPrice) throw new QuoteError('invalid seller prices');
  }

  initial(request: QuoteRequest, now = Date.now()): SignedEnvelope<AgentQuote> {
    return this.issue(request, this.listPrice, 0, now);
  }

  considerCounter(request: QuoteRequest, offered: bigint, now = Date.now()): SignedEnvelope<AgentQuote> | null {
    if (offered < this.minimumPrice) return null;
    return this.issue(request, offered > this.listPrice ? this.listPrice : offered, 1, now);
  }

  private issue(request: QuoteRequest, amount: bigint, round: 0 | 1, now: number): SignedEnvelope<AgentQuote> {
    const quote: AgentQuote = {
      version: 1,
      id: randomUUID(),
      taskId: request.taskId,
      seller: this.seller,
      resource: request.resource,
      method: request.method.toUpperCase(),
      network: request.network,
      asset: request.asset,
      amount: amount.toString(),
      issuedAt: now,
      expiresAt: now + this.ttlMs,
      round,
    };
    return signEnvelope(quote, this.privateKey);
  }
}

export interface NegotiationResult {
  outcome: 'accepted' | 'walked-away';
  quote: SignedEnvelope<AgentQuote> | null;
  countered: boolean;
  reason: string;
}

/** Exactly one counteroffer, matching the Agent Economy track's procurement loop. */
export function negotiateOnce(
  request: QuoteRequest,
  seller: SellerQuoteBook,
  plannedPrice: bigint,
  maxPrice: bigint,
  now = Date.now(),
): NegotiationResult {
  const initial = seller.initial(request, now);
  const initialAmount = BigInt(initial.payload.amount);
  if (initialAmount <= plannedPrice && initialAmount <= maxPrice) {
    return { outcome: 'accepted', quote: initial, countered: false, reason: 'initial quote within plan' };
  }
  const offer = plannedPrice < maxPrice ? plannedPrice : maxPrice;
  const counter = seller.considerCounter(request, offer, now);
  if (!counter) return { outcome: 'walked-away', quote: null, countered: true, reason: 'seller rejected counteroffer' };
  if (BigInt(counter.payload.amount) > maxPrice) return { outcome: 'walked-away', quote: null, countered: true, reason: 'counterquote exceeds maximum' };
  return { outcome: 'accepted', quote: counter, countered: true, reason: 'seller accepted counteroffer' };
}

export function verifyQuote(
  quote: SignedEnvelope<AgentQuote>,
  trustedSellerKeys: ReadonlySet<string>,
  request: QuoteRequest,
  now = Date.now(),
): void {
  if (!verifyEnvelope(quote, trustedSellerKeys)) throw new QuoteError('invalid or untrusted quote signature');
  const q = quote.payload;
  parseAmount(q.amount, 'quote amount');
  if (q.version !== 1 || !q.id || !q.seller || q.taskId !== request.taskId) throw new QuoteError('quote task mismatch');
  if (q.resource !== request.resource || q.method !== request.method.toUpperCase()) throw new QuoteError('quote resource mismatch');
  if (q.network !== request.network || q.asset !== request.asset) throw new QuoteError('quote payment rail mismatch');
  if (now < q.issuedAt || now >= q.expiresAt) throw new QuoteError('quote expired or not yet valid');
}
