import type { SignedEnvelope } from './canonical';
import { sha256 } from './canonical';
import type { TaskCapability } from './models';
import { CapabilityGuard, type CapabilityUse } from './capability';

export type RiskVerdict = 'allow' | 'warn' | 'block';

export interface CounterpartyReport {
  reporter: string;
  payee: string;
  severity: 'warn' | 'block';
  evidence: string;
  reason: string;
  expiresAt: number;
}

export interface PolicyDecision {
  verdict: RiskVerdict;
  reasons: string[];
  decisionId: string;
}

export class PolicyError extends Error {}

/** Evidence-backed counterparty reports. Raw, unsupported accusations are rejected. */
export class CounterpartyRegistry {
  private readonly reports: CounterpartyReport[] = [];

  constructor(private readonly trustedReporters: ReadonlySet<string>) {}

  add(report: CounterpartyReport): void {
    if (!this.trustedReporters.has(report.reporter)) throw new PolicyError('untrusted blocklist reporter');
    if (!report.payee || !report.reason.trim()) throw new PolicyError('report is missing payee or reason');
    if (!/^(https:\/\/|ipfs:\/\/|sha256:)[^\s]+$/.test(report.evidence)) throw new PolicyError('report requires verifiable evidence');
    if (!Number.isSafeInteger(report.expiresAt)) throw new PolicyError('invalid report expiry');
    this.reports.push({ ...report });
  }

  check(payee: string, now = Date.now()): PolicyDecision {
    const active = this.reports.filter((r) => r.payee === payee && r.expiresAt > now);
    const verdict: RiskVerdict = active.some((r) => r.severity === 'block') ? 'block' : active.length ? 'warn' : 'allow';
    const reasons = active.map((r) => `${r.severity}: ${r.reason} (${r.evidence})`);
    return { verdict, reasons, decisionId: sha256({ payee, now, verdict, reasons }) };
  }
}

export class PaymentPolicyEngine {
  constructor(
    private readonly counterparties: CounterpartyRegistry,
    private readonly capabilities: CapabilityGuard,
  ) {}

  authorize(
    capability: SignedEnvelope<TaskCapability>,
    use: CapabilityUse,
    options: { humanApprovedWarning?: boolean; now?: number } = {},
  ): PolicyDecision {
    const now = options.now ?? Date.now();
    const decision = this.counterparties.check(use.payee, now);
    if (decision.verdict === 'block') throw new PolicyError(`payment blocked before signing: ${decision.reasons.join('; ')}`);
    if (decision.verdict === 'warn' && !options.humanApprovedWarning) throw new PolicyError(`human approval required: ${decision.reasons.join('; ')}`);
    this.capabilities.authorize(capability, use, now);
    return decision;
  }
}
