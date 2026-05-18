import { deriveDisplayOrderStatus } from './paymentGroupView';
import { orderHasPaymentScreenshots } from './paymentScreenshotHelpers';
import type { OrderDoc } from '../types/firestore';

/** 需在「消息」中提醒用户处理的饭团订单数 */
export function countFeituanActionableMessages(orders: OrderDoc[]): number {
  let n = 0;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const display = deriveDisplayOrderStatus(o);
    const needsPay =
      display === 'unpaid' ||
      display === 'partial_paid' ||
      (Number(o.pendingAmount ?? 0) > 0.0001 && display !== 'confirmed');
    if (!needsPay) continue;
    const hasShot = orderHasPaymentScreenshots(o.paymentScreenshots);
    if (!hasShot || Number(o.pendingAmount ?? 0) > 0.0001) n += 1;
  }
  return n;
}
