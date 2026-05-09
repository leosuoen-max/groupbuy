import type { OrderRow } from './orderService';
import { orderHasPaymentProof } from './paymentScreenshotHelpers';
import type { OrderDoc } from '../types/firestore';
import { buildPaymentGroups } from './paymentGroups';
import { listOrderCardPaymentApplications } from './orderCardPaymentApplications';
import {
  deliveryPointReconciliationLabel,
  proofRiskDisplayTone,
  linesInSelectedBuckets,
  listOrderPaymentGroups,
  orderMatchesBucketSelection,
  orderNeedsMissingProofLabel,
  scopedGroupAmount,
  type BucketSelection,
  type DeliveryPointLookupMeta,
} from './reconciliationGroups';

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
  /** 已确认构成：钱包支付金额 */
  confirmedWalletAmount: number;
  /** 已确认构成：次卡代扣金额 */
  confirmedPassDeductAmount: number;
  /** 已确认构成：商户免凭证金额 */
  confirmedWaivedNoProofAmount: number;
  /** 有效订单率：已确认单数 / 非取消单数（订单状态口径） */
  effectiveRatePercent: number | null;
};

export type ProductionCountRow = {
  name: string;
  quantity: number;
};

export type ProductionTotals = {
  normalItems: ProductionCountRow[];
  bundleOptionItems: ProductionCountRow[];
  normalTotalQty: number;
  bundleOptionTotalQty: number;
  totalQty: number;
};

function isClaimedPaid(o: OrderDoc): boolean {
  if (orderHasPaymentProof(o.paymentScreenshots)) return true;
  const groups = listOrderPaymentGroups(o);
  return groups.some((g) => g.bucket === 'pending' || g.bucket === 'confirmed');
}

/**
 * 汇总卡片：按「付款组」累加金额；各「单数」为至少含该桶一组的订单笔数（同一订单可重复计入多桶）。
 */
export function buildReconciliationTotals(rows: OrderRow[]): ReconciliationTotals {
  let confirmedAmount = 0;
  let pendingAmount = 0;
  let unpaidAmount = 0;
  let cancelledCount = 0;
  let totalActiveAmount = 0;
  let activeCount = 0;
  let claimedPaidAmount = 0;
  let claimedPaidCount = 0;
  let confirmedWalletAmount = 0;
  let confirmedPassDeductAmount = 0;
  let confirmedWaivedNoProofAmount = 0;

  const confirmedOrders = new Set<string>();
  const pendingOrders = new Set<string>();
  const unpaidOrders = new Set<string>();

  let orderLevelConfirmedForRate = 0;
  const cardComponentAdded = new Set<string>();

  for (const row of rows) {
    const o = row.data;
    const amt = o.totalAmount ?? 0;
    if (o.status === 'cancelled') {
      cancelledCount += 1;
      continue;
    }
    activeCount += 1;
    totalActiveAmount += amt;
    const groups = listOrderPaymentGroups(o);
    if (groups.length > 0 && groups.every((g) => g.bucket === 'confirmed')) {
      orderLevelConfirmedForRate += 1;
    }
    const paymentGroups = buildPaymentGroups(o);
    const hasConfirmedWaive = paymentGroups.some(
      (g) => g.status === 'confirmed' && g.proofs.some((p) => p.waivedNoScreenshot)
    );
    if (hasConfirmedWaive) {
      confirmedWaivedNoProofAmount += paymentGroups
        .filter((g) => g.status === 'confirmed' && g.proofs.some((p) => p.waivedNoScreenshot))
        .reduce((s, g) => s + (Number(g.subtotal) || 0), 0);
    }
    const cardApps = listOrderCardPaymentApplications(o);
    if (!cardComponentAdded.has(row.id) && cardApps.length > 0) {
      for (const cp of cardApps) {
        const wallet = Number(cp.wallet?.deduct ?? 0) || 0;
        const totalDeducted = Number(cp.totalDeducted ?? 0) || 0;
        confirmedWalletAmount += wallet;
        confirmedPassDeductAmount += Math.max(0, totalDeducted - wallet);
      }
      cardComponentAdded.add(row.id);
    }

    let cAmt = 0;
    let pAmt = 0;
    let uAmt = 0;
    for (const g of groups) {
      if (g.bucket === 'confirmed') {
        confirmedAmount += g.amount;
        cAmt += g.amount;
      } else if (g.bucket === 'pending') {
        pendingAmount += g.amount;
        pAmt += g.amount;
      } else {
        unpaidAmount += g.amount;
        uAmt += g.amount;
      }
    }
    if (cAmt > 0) confirmedOrders.add(row.id);
    if (pAmt > 0) pendingOrders.add(row.id);
    if (uAmt > 0) unpaidOrders.add(row.id);

    if (isClaimedPaid(o)) {
      claimedPaidAmount += amt;
      claimedPaidCount += 1;
    }
  }

  const effectiveRatePercent =
    activeCount > 0
      ? Math.round((orderLevelConfirmedForRate / activeCount) * 1000) / 10
      : null;

  return {
    confirmedAmount,
    confirmedCount: confirmedOrders.size,
    pendingAmount,
    pendingCount: pendingOrders.size,
    unpaidAmount,
    unpaidCount: unpaidOrders.size,
    partialPaidPendingAmount: 0,
    partialPaidCount: 0,
    cancelledCount,
    totalActiveAmount,
    activeCount,
    claimedPaidAmount,
    claimedPaidCount,
    confirmedWalletAmount,
    confirmedPassDeductAmount,
    confirmedWaivedNoProofAmount,
    effectiveRatePercent,
  };
}

export function buildReconciliationCopyText(params: {
  shopName: string;
  projectLabel: string;
  rows: OrderRow[];
  totals: ReconciliationTotals;
  bucketSelection: BucketSelection;
  deliveryPointLookup?: Map<string, DeliveryPointLookupMeta> | null;
}): string {
  const {
    shopName,
    projectLabel,
    rows,
    totals,
    bucketSelection,
    deliveryPointLookup = null,
  } = params;
  const lines: string[] = [];
  lines.push(`${shopName} · ${projectLabel}对账单`);
  lines.push('=============');

  const activeRows = rows.filter((r) => r.data.status !== 'cancelled');

  const bucketMeta: {
    key: keyof BucketSelection;
    title: string;
    amount: number;
    countKey: 'confirmedCount' | 'pendingCount' | 'unpaidCount';
  }[] = [
    {
      key: 'confirmed',
      title: '已确认（组口径金额）',
      amount: totals.confirmedAmount,
      countKey: 'confirmedCount',
    },
    {
      key: 'pending',
      title: '待确认（组口径金额）',
      amount: totals.pendingAmount,
      countKey: 'pendingCount',
    },
    {
      key: 'unpaid',
      title: '待付款（组口径金额）',
      amount: totals.unpaidAmount,
      countKey: 'unpaidCount',
    },
  ];

  for (const bm of bucketMeta) {
    if (!bucketSelection[bm.key]) continue;
    lines.push(
      `${bm.title}：${formatRm(bm.amount)} · ${totals[bm.countKey]} 笔订单（至少含一档该类）`
    );
    const byPoint = new Map<string, OrderRow[]>();
    for (const r of activeRows) {
      const g = listOrderPaymentGroups(r.data);
      if (!g.some((x) => x.bucket === bm.key)) continue;
      const dp = deliveryPointReconciliationLabel(r.data, deliveryPointLookup);
      if (!byPoint.has(dp)) byPoint.set(dp, []);
      byPoint.get(dp)!.push(r);
    }
    const sortedPoints = [...byPoint.keys()].sort((a, b) =>
      a.localeCompare(b, 'zh-CN')
    );
    for (const dp of sortedPoints) {
      lines.push(`— ${dp} —`);
      const list = byPoint.get(dp)!;
      list.sort((a, b) => {
        const ta = a.data.createdAt?.toMillis?.() ?? 0;
        const tb = b.data.createdAt?.toMillis?.() ?? 0;
        return ta - tb;
      });
      for (const r of list) {
        const g = listOrderPaymentGroups(r.data);
        const sliceAmt = g
          .filter((x) => x.bucket === bm.key)
          .reduce((s, x) => s + x.amount, 0);
        const detail = formatLinesDetail(
          linesInSelectedBuckets(g, {
            confirmed: bm.key === 'confirmed',
            pending: bm.key === 'pending',
            unpaid: bm.key === 'unpaid',
          })
        );
        lines.push(
          `${r.data.customerName} #${r.data.orderNumber} ${formatRm(sliceAmt)} · ${detail}`
        );
      }
    }
    lines.push('');
  }

  lines.push(
    `已确认金额：${formatRm(totals.confirmedAmount)} · 待确认：${formatRm(totals.pendingAmount)} · 待付款：${formatRm(totals.unpaidAmount)}`
  );
  lines.push(`订单总额（未取消）：${formatRm(totals.totalActiveAmount)} / ${totals.activeCount} 单`);
  if (totals.effectiveRatePercent != null) {
    lines.push(`有效订单率（订单状态已确认/未取消）：${totals.effectiveRatePercent}%`);
  }
  lines.push('=============');
  return lines.join('\n');
}

function formatRm(n: number): string {
  return `RM ${n.toFixed(2)}`;
}

function formatLinesDetail(lines: OrderDoc['lines']): string {
  const arr = lines ?? [];
  if (arr.length === 0) return '—';
  return arr.map((l) => `${l.name}×${l.quantity}`).join('；');
}

function formatOrderTime(o: OrderDoc): string {
  const d = o.createdAt?.toDate?.();
  if (!d) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function proofExportLabel(o: OrderDoc): string {
  if (orderNeedsMissingProofLabel(o)) return '缺少凭证';
  const f = proofRiskDisplayTone(o);
  if (f === 'red') return '红旗';
  if (f === 'yellow') return '黄旗';
  return '绿旗';
}

function toSortedCountRows(m: Map<string, number>): ProductionCountRow[] {
  return [...m.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}

/** 从套餐行名称中拆出系列单项，例如：`二荤一素（标准） 汤:鸡汤；饭:白饭` => [鸡汤, 白饭] */
function extractBundleOptionNames(lineName: string): string[] {
  const raw = lineName.trim();
  if (!raw) return [];
  const idx = raw.indexOf('）');
  const tail = (idx >= 0 ? raw.slice(idx + 1) : raw).trim();
  if (!tail) return [];

  const out: string[] = [];
  const groups = tail.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
  for (const g of groups) {
    const seg = g.includes('：')
      ? g.split('：').slice(1).join('：').trim()
      : g.includes(':')
        ? g.split(':').slice(1).join(':').trim()
        : g;
    if (!seg) continue;
    for (const n of seg.split(/[、,，]/).map((x) => x.trim()).filter(Boolean)) {
      out.push(n);
    }
  }
  return out;
}

/** 厨房生产统计：普通商品数量 + 套餐拆解单项数量（复用当前筛选口径） */
export function buildProductionTotals(
  rows: OrderRow[],
  bucketSelection: BucketSelection
): ProductionTotals {
  const normal = new Map<string, number>();
  const bundleOptions = new Map<string, number>();
  let normalTotalQty = 0;
  let bundleOptionTotalQty = 0;

  for (const r of rows) {
    const o = r.data;
    if (o.status === 'cancelled') continue;
    const groups = listOrderPaymentGroups(o);
    if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;
    const scopedLines = linesInSelectedBuckets(groups, bucketSelection);
    for (const line of scopedLines) {
      const qty = Math.max(0, Number(line.quantity) || 0);
      if (qty <= 0) continue;
      const isBundle = String(line.productId ?? '').startsWith('bundle:');
      if (!isBundle) {
        const key = line.name?.trim() || '未命名商品';
        normal.set(key, (normal.get(key) ?? 0) + qty);
        normalTotalQty += qty;
        continue;
      }
      const optionNames = extractBundleOptionNames(line.name ?? '');
      if (optionNames.length === 0) {
        const key = line.name?.trim() || '未命名套餐项';
        bundleOptions.set(key, (bundleOptions.get(key) ?? 0) + qty);
        bundleOptionTotalQty += qty;
        continue;
      }
      for (const name of optionNames) {
        bundleOptions.set(name, (bundleOptions.get(name) ?? 0) + qty);
        bundleOptionTotalQty += qty;
      }
    }
  }

  return {
    normalItems: toSortedCountRows(normal),
    bundleOptionItems: toSortedCountRows(bundleOptions),
    normalTotalQty,
    bundleOptionTotalQty,
    totalQty: normalTotalQty + bundleOptionTotalQty,
  };
}

export function buildProductionCopyText(params: {
  shopName: string;
  projectLabel: string;
  totals: ProductionTotals;
}): string {
  const { shopName, projectLabel, totals } = params;
  const out: string[] = [];
  out.push(`${shopName} · ${projectLabel}厨房生产统计`);
  out.push('=============');
  out.push(`总份数：${totals.totalQty}`);
  out.push(`普通商品：${totals.normalTotalQty}`);
  out.push(`套餐拆解单项：${totals.bundleOptionTotalQty}`);
  out.push('');
  out.push(`普通商品（${totals.normalItems.length}种）`);
  if (totals.normalItems.length === 0) out.push('—');
  for (const r of totals.normalItems) out.push(`${r.name} × ${r.quantity}`);
  out.push('');
  out.push(`套餐拆解（${totals.bundleOptionItems.length}项）`);
  if (totals.bundleOptionItems.length === 0) out.push('—');
  for (const r of totals.bundleOptionItems) out.push(`${r.name} × ${r.quantity}`);
  out.push('=============');
  return out.join('\n');
}

export function buildProductionCsv(totals: ProductionTotals): string {
  const lines = ['类型,名称,数量'];
  for (const r of totals.normalItems) {
    lines.push(`普通商品,"${r.name.replace(/"/g, '""')}",${r.quantity}`);
  }
  for (const r of totals.bundleOptionItems) {
    lines.push(`套餐拆解,"${r.name.replace(/"/g, '""')}",${r.quantity}`);
  }
  return lines.join('\n');
}

export function buildReconciliationCsv(
  rows: OrderRow[],
  bucketSelection: BucketSelection,
  deliveryPointLookup?: Map<string, DeliveryPointLookupMeta> | null
): string {
  const header = [
    '配送点',
    '时间',
    '顾客',
    '电话',
    '订单号',
    '项目',
    '商品明细',
    '清单金额',
    '订单状态',
    '凭证',
  ];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const outLines = [header.join(',')];
  const sorted = [...rows].sort((a, b) => {
    const da = deliveryPointReconciliationLabel(a.data, deliveryPointLookup ?? null);
    const db = deliveryPointReconciliationLabel(b.data, deliveryPointLookup ?? null);
    if (da !== db) return da.localeCompare(db, 'zh-CN');
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return ta - tb;
  });
  for (const r of sorted) {
    const o = r.data;
    if (o.status === 'cancelled') continue;
    const groups = listOrderPaymentGroups(o);
    if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;
    const scopedAmt = scopedGroupAmount(groups, bucketSelection);
    const detailLines = linesInSelectedBuckets(groups, bucketSelection);
    outLines.push(
      [
        esc(deliveryPointReconciliationLabel(o, deliveryPointLookup ?? null)),
        esc(formatOrderTime(o)),
        esc(o.customerName ?? ''),
        esc(o.customerPhone ?? ''),
        esc(o.orderNumber),
        esc(o.projectTitle ?? ''),
        esc(formatLinesDetail(detailLines)),
        scopedAmt.toFixed(2),
        esc(o.status),
        esc(proofExportLabel(o)),
      ].join(',')
    );
  }
  return outLines.join('\n');
}
