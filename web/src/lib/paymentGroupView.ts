import type { OrderDoc, OrderStatus } from '../types/firestore';
import { buildPaymentGroups, type PaymentGroup } from './paymentGroups';

export function deriveDisplayOrderStatus(
  order: OrderDoc,
  groups: PaymentGroup[] = buildPaymentGroups(order)
): OrderStatus {
  if (order.status === 'cancelled') return 'cancelled';
  if (groups.some((g) => g.status === 'pending')) return 'pending';
  if (groups.some((g) => g.status === 'unpaid')) return 'partial_paid';
  return 'confirmed';
}

export function sumGroupAmountByStatus(
  groups: PaymentGroup[],
  status: PaymentGroup['status']
): number {
  return groups
    .filter((g) => g.status === status)
    .reduce((s, g) => s + (Number(g.subtotal) || 0), 0);
}
