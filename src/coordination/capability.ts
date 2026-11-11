import type { SignedEnvelope } from './canonical';
import { verifyEnvelope } from './canonical';
import { parseAmount } from './budget';
import type { TaskCapability } from './models';

export interface CapabilityUse {
  subject: string;
  network: string;
  asset: string;
  payee: string;
  method: string;
  resource: string;
  amount: bigint;
}

interface Usage { calls: number; spent: bigint }
export class CapabilityError extends Error {}

export class CapabilityGuard {
  private readonly usage = new Map<string, Usage>();

  constructor(private readonly trustedIssuers: ReadonlySet<string>) {}

  authorize(envelope: SignedEnvelope<TaskCapability>, use: CapabilityUse, now = Date.now()): void {
    if (!verifyEnvelope(envelope, this.trustedIssuers)) throw new CapabilityError('invalid or untrusted capability signature');
    const c = envelope.payload;
    validateCapability(c);
    if (now < c.notBefore || now >= c.expiresAt) throw new CapabilityError('capability is not currently valid');
    if (use.subject !== c.subject) throw new CapabilityError('capability subject mismatch');
    if (use.network !== c.network || use.asset !== c.asset) throw new CapabilityError('network or asset mismatch');
    if (!c.allowedPayees.includes(use.payee)) throw new CapabilityError('payee is not allowed');
    if (!c.allowedMethods.includes(use.method.toUpperCase())) throw new CapabilityError('method is not allowed');
    if (!c.allowedResourcePrefixes.some((prefix) => use.resource.startsWith(prefix))) throw new CapabilityError('resource is not allowed');
    if (use.amount <= 0n || use.amount > BigInt(c.maxPerCall)) throw new CapabilityError('per-call limit exceeded');

    const prior = this.usage.get(c.id) ?? { calls: 0, spent: 0n };
    if (prior.calls + 1 > c.maxCalls) throw new CapabilityError('capability call limit exceeded');
    if (prior.spent + use.amount > BigInt(c.maxTotal)) throw new CapabilityError('capability total limit exceeded');
    this.usage.set(c.id, { calls: prior.calls + 1, spent: prior.spent + use.amount });
  }

  usageFor(id: string) {
    const usage = this.usage.get(id) ?? { calls: 0, spent: 0n };
    return { calls: usage.calls, spent: usage.spent.toString() };
  }
}

export function validateCapability(c: TaskCapability): void {
  if (c.version !== 1 || !c.id || !c.programId || !c.taskId || !c.subject) throw new CapabilityError('malformed capability');
  if (!Number.isSafeInteger(c.maxCalls) || c.maxCalls < 1) throw new CapabilityError('invalid maxCalls');
  if (!Number.isSafeInteger(c.notBefore) || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= c.notBefore) throw new CapabilityError('invalid validity window');
  if (!Number.isSafeInteger(c.delegationDepth) || c.delegationDepth < 0) throw new CapabilityError('invalid delegation depth');
  const perCall = parseAmount(c.maxPerCall, 'maxPerCall');
  const total = parseAmount(c.maxTotal, 'maxTotal');
  if (perCall <= 0n || total <= 0n || perCall > total) throw new CapabilityError('invalid capability limits');
}
