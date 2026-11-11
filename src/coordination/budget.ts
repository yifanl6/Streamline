import { randomUUID } from 'node:crypto';
import type { ProgramBudget } from './models';

interface Reservation {
  id: string;
  amount: bigint;
  payee: string;
  service: string;
  state: 'reserved' | 'settled' | 'released';
  transaction?: string;
}

export class BudgetError extends Error {}

export class TaskBudget {
  private spentAmount = 0n;
  private reservedAmount = 0n;
  private readonly reservations = new Map<string, Reservation>();

  constructor(readonly program: ProgramBudget) {
    const total = parseAmount(program.total, 'total');
    if (total <= 0n) throw new BudgetError('budget total must be positive');
    if (!Number.isSafeInteger(program.expiresAt)) throw new BudgetError('invalid budget expiry');
  }

  get total(): bigint { return BigInt(this.program.total); }
  get spent(): bigint { return this.spentAmount; }
  get reserved(): bigint { return this.reservedAmount; }
  get remaining(): bigint { return this.total - this.spentAmount - this.reservedAmount; }

  reserve(amount: bigint, payee: string, service: string, now = Date.now()): string {
    if (now >= this.program.expiresAt) throw new BudgetError('budget expired');
    if (amount <= 0n) throw new BudgetError('amount must be positive');
    if (!this.program.allowedPayees.includes(payee)) throw new BudgetError(`payee ${payee} is not allowed`);
    if (!this.program.allowedServices.includes(service)) throw new BudgetError(`service ${service} is not allowed`);
    if (amount > this.remaining) throw new BudgetError(`amount ${amount} exceeds remaining budget ${this.remaining}`);

    const id = randomUUID();
    this.reservations.set(id, { id, amount, payee, service, state: 'reserved' });
    this.reservedAmount += amount;
    return id;
  }

  settle(id: string, transaction: string): void {
    const reservation = this.getReserved(id);
    reservation.state = 'settled';
    reservation.transaction = transaction;
    this.reservedAmount -= reservation.amount;
    this.spentAmount += reservation.amount;
  }

  release(id: string): void {
    const reservation = this.getReserved(id);
    reservation.state = 'released';
    this.reservedAmount -= reservation.amount;
  }

  snapshot() {
    return {
      programId: this.program.id,
      total: this.total.toString(),
      spent: this.spent.toString(),
      reserved: this.reserved.toString(),
      remaining: this.remaining.toString(),
      reservations: [...this.reservations.values()].map((r) => ({ ...r, amount: r.amount.toString() })),
    };
  }

  private getReserved(id: string): Reservation {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new BudgetError('unknown reservation');
    if (reservation.state !== 'reserved') throw new BudgetError(`reservation already ${reservation.state}`);
    return reservation;
  }
}

export function parseAmount(value: string, label = 'amount'): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new BudgetError(`${label} must be an unsigned decimal integer string`);
  return BigInt(value);
}
