import {
  computeFeituanTabBadgeFromRows,
  countFeituanPaymentTodos,
} from './feituanMessages';
import type { OrderDoc } from '../types/firestore';

export { computeFeituanTabBadgeFromRows };

/** @deprecated 仅统计待办；Tab 角标请用 computeFeituanTabBadgeFromRows */
export function countFeituanActionableMessages(orders: OrderDoc[]): number {
  return countFeituanPaymentTodos(orders);
}
