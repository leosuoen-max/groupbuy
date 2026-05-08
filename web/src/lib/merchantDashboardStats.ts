import type { OrderRow } from './orderService';
import { buildPaymentGroups } from './paymentGroups';

/** Dashboard「今日」汇总（按浏览器本地日历日从 createdAt 判定） */
export type ShopDashboardTodayStats = {
  /** 今日下单且状态为已确认 */
  confirmedCount: number;
  confirmedRevenue: number;
  /** 今日下单且待商户核对（pending / partial_paid） */
  pendingReviewCount: number;
  pendingReviewAmount: number;
  /** 今日下单且尚未付款（unpaid） */
  unpaidCount: number;
  unpaidAmount: number;
  /** 今日有下单的总笔数（不含仅草稿以外的 cancelled 是否算——这里统计今日创建的非 cancelled 总数更清晰） */
  todayOpenOrdersCount: number;
};

function dayBoundsMs(now: Date): { start: number; end: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * 从店铺订单列表中筛出「今日创建」的订单并聚合（用于商户 Dashboard）。
 */
export function aggregateShopOrdersForToday(
  rows: OrderRow[],
  now: Date = new Date()
): ShopDashboardTodayStats {
  const { start, end } = dayBoundsMs(now);

  const confirmedOrders = new Set<string>();
  const pendingOrders = new Set<string>();
  const unpaidOrders = new Set<string>();
  let confirmedRevenue = 0;
  let pendingReviewAmount = 0;
  let unpaidAmount = 0;
  let todayOpenOrdersCount = 0;

  for (const r of rows) {
    const createdMs = r.data.createdAt?.toMillis?.() ?? 0;
    if (createdMs < start || createdMs > end) continue;

    const o = r.data;
    if (o.status === 'cancelled') continue;

    todayOpenOrdersCount += 1;

    const groups = buildPaymentGroups(o);
    let hasConfirmed = false;
    let hasPending = false;
    let hasUnpaid = false;
    for (const g of groups) {
      const amt = Number(g.subtotal) || 0;
      if (g.status === 'confirmed') {
        confirmedRevenue += amt;
        hasConfirmed = true;
      } else if (g.status === 'pending') {
        pendingReviewAmount += amt;
        hasPending = true;
      } else {
        unpaidAmount += amt;
        hasUnpaid = true;
      }
    }
    if (hasConfirmed) confirmedOrders.add(r.id);
    if (hasPending) pendingOrders.add(r.id);
    if (hasUnpaid) unpaidOrders.add(r.id);
  }

  return {
    confirmedCount: confirmedOrders.size,
    confirmedRevenue,
    pendingReviewCount: pendingOrders.size,
    pendingReviewAmount,
    unpaidCount: unpaidOrders.size,
    unpaidAmount,
    todayOpenOrdersCount,
  };
}
