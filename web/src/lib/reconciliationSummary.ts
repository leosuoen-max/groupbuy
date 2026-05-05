import type { OrderRow } from './orderService';
import { orderHasPaymentProof } from './paymentScreenshotHelpers';
import type { OrderDoc, OrderStatus } from '../types/firestore';

export type ReconciliationTotals = {
  confirmedAmount: number;
  confirmedCount: number;
  pendingAmount: number;
  pendingCount: number;
  unpaidAmount: number;
  unpaidCount: number;
  partialPaidPendingAmount: number;
  partialPaidCount: number;
  cancelledCount: number;
  /** 非取消订单合计金额 */
  totalActiveAmount: number;
  activeCount: number;
  /** 声称已付：已上传截图，或状态为待确认/已确认/部分付款（与收款流水对账时参考） */
  claimedPaidAmount: number;
  claimedPaidCount: number;
  /** 有效订单率：已确认单数 / 非取消单数 */
  effectiveRatePercent: number | null;
};

function isClaimedPaid(o: OrderDoc): boolean {
  if (orderHasPaymentProof(o.paymentScreenshots)) return true;
  const s: OrderStatus = o.status;
  return s === 'pending' || s === 'confirmed' || s === 'partial_paid';
}

export function buildReconciliationTotals(rows: OrderRow[]): ReconciliationTotals {
  let confirmedAmount = 0;
  let confirmedCount = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  let unpaidAmount = 0;
  let unpaidCount = 0;
  let partialPaidPendingAmount = 0;
  let partialPaidCount = 0;
  let cancelledCount = 0;
  let totalActiveAmount = 0;
  let activeCount = 0;
  let claimedPaidAmount = 0;
  let claimedPaidCount = 0;

  for (const row of rows) {
    const o = row.data;
    const amt = o.totalAmount ?? 0;
    if (o.status === 'cancelled') {
      cancelledCount += 1;
      continue;
    }
    activeCount += 1;
    totalActiveAmount += amt;

    switch (o.status) {
      case 'confirmed':
        confirmedAmount += amt;
        confirmedCount += 1;
        break;
      case 'pending':
        pendingAmount += amt;
        pendingCount += 1;
        break;
      case 'unpaid':
        unpaidAmount += amt;
        unpaidCount += 1;
        break;
      case 'partial_paid':
        partialPaidPendingAmount += o.pendingAmount ?? 0;
        partialPaidCount += 1;
        confirmedAmount += o.paidAmount ?? 0;
        break;
      default:
        break;
    }

    if (isClaimedPaid(o)) {
      claimedPaidAmount += amt;
      claimedPaidCount += 1;
    }
  }

  const effectiveRatePercent =
    activeCount > 0
      ? Math.round((confirmedCount / activeCount) * 1000) / 10
      : null;

  return {
    confirmedAmount,
    confirmedCount,
    pendingAmount,
    pendingCount,
    unpaidAmount,
    unpaidCount,
    partialPaidPendingAmount,
    partialPaidCount,
    cancelledCount,
    totalActiveAmount,
    activeCount,
    claimedPaidAmount,
    claimedPaidCount,
    effectiveRatePercent,
  };
}

export function buildReconciliationCopyText(params: {
  shopName: string;
  projectLabel: string;
  rows: OrderRow[];
  totals: ReconciliationTotals;
}): string {
  const { shopName, projectLabel, rows, totals } = params;
  const lines: string[] = [];
  lines.push(`${shopName} · ${projectLabel}对账单`);
  lines.push('=============');

  const confirmed = rows.filter((r) => r.data.status === 'confirmed');
  const pending = rows.filter((r) => r.data.status === 'pending');
  const unpaid = rows.filter((r) => r.data.status === 'unpaid');

  lines.push(`已确认（${totals.confirmedCount} 单）`);
  for (const r of confirmed) {
    lines.push(
      `${r.data.customerName} #${r.data.orderNumber} ${formatRm(r.data.totalAmount)}`
    );
  }
  lines.push('');
  lines.push(`待确认（${totals.pendingCount} 单）`);
  for (const r of pending) {
    lines.push(
      `${r.data.customerName} #${r.data.orderNumber} ${formatRm(r.data.totalAmount)}`
    );
  }
  lines.push('');
  lines.push(`未付款（${totals.unpaidCount} 单）`);
  for (const r of unpaid) {
    lines.push(
      `${r.data.customerName} #${r.data.orderNumber} ${formatRm(r.data.totalAmount)}`
    );
  }
  lines.push('');
  lines.push(
    `已确认金额：${formatRm(totals.confirmedAmount)} · 待确认：${formatRm(totals.pendingAmount)} · 待付款：${formatRm(
      totals.unpaidAmount + totals.partialPaidPendingAmount
    )}`
  );
  lines.push(`订单总额（未取消）：${formatRm(totals.totalActiveAmount)} / ${totals.activeCount} 单`);
  if (totals.effectiveRatePercent != null) {
    lines.push(`有效订单率（已确认/未取消）：${totals.effectiveRatePercent}%`);
  }
  lines.push('=============');
  return lines.join('\n');
}

function formatRm(n: number): string {
  return `RM ${n.toFixed(2)}`;
}

function orderLinesSummary(o: OrderDoc): string {
  const lines = o.lines ?? [];
  if (lines.length === 0) return '—';
  const first = lines[0];
  const more = lines.length > 1 ? ` 等${lines.length}项` : '';
  return `${first.name}×${first.quantity}${more}`;
}

function formatOrderTime(o: OrderDoc): string {
  const d = o.createdAt?.toDate?.();
  if (!d) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildReconciliationCsv(rows: OrderRow[]): string {
  const header = [
    '时间',
    '顾客',
    '电话',
    '订单号',
    '项目',
    '商品摘要',
    '金额',
    '状态',
    '有付款截图',
  ];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  const sorted = [...rows].sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return ta - tb;
  });
  for (const r of sorted) {
    const o = r.data;
    const hasShot = orderHasPaymentProof(o.paymentScreenshots) ? '是' : '否';
    lines.push(
      [
        esc(formatOrderTime(o)),
        esc(o.customerName ?? ''),
        esc(o.customerPhone ?? ''),
        esc(o.orderNumber),
        esc(o.projectTitle ?? ''),
        esc(orderLinesSummary(o)),
        o.totalAmount.toFixed(2),
        esc(o.status),
        hasShot,
      ].join(',')
    );
  }
  return lines.join('\n');
}
