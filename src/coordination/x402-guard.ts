import type { SignedEnvelope } from './canonical';
import type { TaskCapability } from './models';
import type { PaymentPolicyEngine } from './policy';

export interface GuardablePayment {
  method: 'GET';
  resource: string;
  payTo: string;
  amount: bigint;
  network: string;
  asset: string;
}

/** Adapter used as the x402 client's beforeSign hook. A rejection makes signing unreachable. */
export function x402CapabilityGuard(
  engine: PaymentPolicyEngine,
  capability: SignedEnvelope<TaskCapability>,
  subject: string,
  humanApprovedWarning = false,
) {
  return (payment: GuardablePayment) => engine.authorize(capability, {
    subject,
    network: payment.network,
    asset: payment.asset,
    payee: payment.payTo,
    method: payment.method,
    resource: payment.resource,
    amount: payment.amount,
  }, { humanApprovedWarning });
}
