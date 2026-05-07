import type { OrderDoc } from '../types/firestore';
import { parseScreenshotEntries } from './paymentScreenshotHelpers';

type GroupingOrder = Pick<
  OrderDoc,
  'status' | 'initialPaymentConfirmedAt' | 'appendBatches' | 'paymentScreenshots'
>;

/**
 * 分组唯一边界：支付动作。
 * 在没有任何支付动作（传图/免凭证/卡自动确认/商户已确认）前，
 * 同一订单下的下单与加购都属于同一个待付款组。
 */
export function orderHasNoPaymentActionYet(order: GroupingOrder): boolean {
  if (order.status === 'cancelled' || order.status === 'confirmed') return false;
  if (order.initialPaymentConfirmedAt) return false;
  if ((order.appendBatches ?? []).some((b) => Boolean(b.confirmedAt))) return false;
  const hasAnyProof = parseScreenshotEntries(order.paymentScreenshots).some(
    (x) => Boolean(x.url) || x.waivedNoScreenshot
  );
  return !hasAnyProof;
}

