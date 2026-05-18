import type {
  DeliveryPointDoc,
  OrderDoc,
  OrderLineDoc,
} from '../types/firestore';
import {
  parseScreenshotEntries,
} from './paymentScreenshotHelpers';
import { buildPaymentGroups } from './paymentGroups';

/** 与对账单、订单详情一致的「付款组」分类 */
export type GroupBucket = 'confirmed' | 'pending' | 'unpaid';

export type OrderPaymentGroup = {
  key: string;
  kind: 'initial' | 'append';
  batchId?: string;
  bucket: GroupBucket;
  amount: number;
  lines: OrderLineDoc[];
};

/** 配送点展示：无则统一文案 */
export function deliveryPointLabel(o: OrderDoc): string {
  const n = o.deliveryPointSnapshot?.name?.trim();
  return n || '未指定配送点';
}

/** 由配送点文档 id 查到编号 + 简称，供对账单紧凑展示 */
export type DeliveryPointLookupMeta = { code: string; shortName: string };

export function buildDeliveryPointLookup(
  rows: Array<{ id: string; data: DeliveryPointDoc }>
): Map<string, DeliveryPointLookupMeta> {
  const m = new Map<string, DeliveryPointLookupMeta>();
  for (const r of rows) {
    const code = (r.data.code ?? '').trim();
    const shortName = (r.data.shortName ?? r.data.name ?? '').trim();
    m.set(r.id, {
      code: code || '—',
      shortName: shortName || '—',
    });
  }
  return m;
}

/**
 * 对账单用：有 deliveryPointId 且能在库里命中时显示 `[编号] 简称`，否则回落到订单快照名称。
 */
export function deliveryPointReconciliationLabel(
  o: OrderDoc,
  lookup?: Map<string, DeliveryPointLookupMeta> | null
): string {
  const id = o.deliveryPointId?.trim();
  if (id && lookup?.has(id)) {
    const x = lookup.get(id)!;
    return `[${x.code}] ${x.shortName}`;
  }
  return deliveryPointLabel(o);
}

/**
 * 将订单拆成首单档 + 各加购档，与 MerchantOrderDetail 使用同一套 initial / append 推断。
 */
export function listOrderPaymentGroups(o: OrderDoc): OrderPaymentGroup[] {
  if (o.status === 'cancelled') return [];
  return buildPaymentGroups(o).map((g) => ({
    key: g.id,
    kind: g.includesInitial ? 'initial' : 'append',
    ...(g.appendBatchIds.length === 1 ? { batchId: g.appendBatchIds[0] } : {}),
    bucket: g.status,
    amount: Number(g.subtotal) || 0,
    lines: g.lines,
  }));
}

export type BucketSelection = Record<GroupBucket, boolean>;

export const DEFAULT_BUCKET_SELECTION: BucketSelection = {
  confirmed: true,
  pending: true,
  unpaid: true,
};

/** 生产统计默认仅计入已确认支付组 */
export const PRODUCTION_DEFAULT_BUCKET_SELECTION: BucketSelection = {
  confirmed: true,
  pending: false,
  unpaid: false,
};

export function scopedGroupAmount(
  groups: OrderPaymentGroup[],
  sel: BucketSelection
): number {
  let s = 0;
  for (const g of groups) {
    if (sel[g.bucket]) s += g.amount;
  }
  return s;
}

export function orderMatchesBucketSelection(
  groups: OrderPaymentGroup[],
  sel: BucketSelection
): boolean {
  return groups.some((g) => sel[g.bucket]);
}

/** 仅包含当前选中桶内的组的明细行（用于列表「内容」列） */
export function linesInSelectedBuckets(
  groups: OrderPaymentGroup[],
  sel: BucketSelection
): OrderLineDoc[] {
  const acc: OrderLineDoc[] = [];
  for (const g of groups) {
    if (!sel[g.bucket]) continue;
    acc.push(...g.lines);
  }
  return acc;
}

/**
 * 凭证列：任意免提交 / 未付清 / 待付款状态 → 文案「缺少凭证」；
 * 否则仅展示截图风险旗标中级别最高者（绿/黄/红）。
 */
export function orderNeedsMissingProofLabel(o: OrderDoc): boolean {
  const entries = parseScreenshotEntries(o.paymentScreenshots);
  if (entries.some((e) => e.waivedNoScreenshot)) return true;
  if (buildPaymentGroups(o).some((g) => g.status === 'unpaid')) return true;
  return false;
}

export function highestProofRiskFlag(
  o: OrderDoc
): 'green' | 'yellow' | 'red' | null {
  const entries = parseScreenshotEntries(o.paymentScreenshots);
  let best: 'green' | 'yellow' | 'red' | null = null;
  const rank: Record<'red' | 'yellow' | 'green', number> = {
    red: 3,
    yellow: 2,
    green: 1,
  };
  for (const e of entries) {
    if (!e.url) continue;
    if (!e.flag) continue;
    if (!best || rank[e.flag] > rank[best]) best = e.flag;
  }
  return best;
}

/**
 * 对账单展示用：在已判定「非缺少凭证」的前提下，无旗标视为绿（未识别风险按安全处理，与业务默认一致）。
 */
export function proofRiskDisplayTone(o: OrderDoc): 'green' | 'yellow' | 'red' {
  return highestProofRiskFlag(o) ?? 'green';
}
