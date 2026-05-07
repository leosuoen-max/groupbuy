import type { OrderAppendBatchDoc, OrderDoc, OrderLineDoc } from '../types/firestore';
import {
  canMerchantConfirmAppendBatchByScreenshots,
  parseScreenshotEntries,
} from './paymentScreenshotHelpers';

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

const EPS = 0.001;

/** 配送点展示：无则统一文案 */
export function deliveryPointLabel(o: OrderDoc): string {
  const n = o.deliveryPointSnapshot?.name?.trim();
  return n || '未指定配送点';
}

/**
 * 将订单拆成首单档 + 各加购档，与 MerchantOrderDetail 使用同一套 initial / append 推断。
 */
export function listOrderPaymentGroups(o: OrderDoc): OrderPaymentGroup[] {
  if (o.status === 'cancelled') return [];

  const appendBatches = o.appendBatches ?? [];
  const legacyNoSplit =
    appendBatches.length > 0 && !(o.initialLines?.length ?? 0);
  const initialLines: OrderLineDoc[] = legacyNoSplit
    ? o.lines
    : o.initialLines?.length
      ? o.initialLines
      : o.lines;

  const initialTotal =
    o.initialTotalAmount ??
    initialLines.reduce((s, l) => s + l.subtotal, 0);

  const firstPaymentAcknowledged =
    !!o.initialPaymentConfirmedAt ||
    (initialTotal > EPS &&
      Number(o.paidAmount) + EPS >= initialTotal &&
      (o.status === 'confirmed' || o.status === 'partial_paid'));

  const pendingIds = appendBatches.filter((b) => !b.confirmedAt).map((b) => b.id);

  const out: OrderPaymentGroup[] = [];

  const initialAmt =
    initialTotal > EPS
      ? initialTotal
      : initialLines.reduce((s, l) => s + l.subtotal, 0);

  if (initialAmt > EPS || initialLines.length > 0) {
    let bucket: GroupBucket;
    if (firstPaymentAcknowledged) {
      bucket = 'confirmed';
    } else if (o.status === 'pending') {
      bucket = 'pending';
    } else if (o.status === 'unpaid') {
      bucket = 'unpaid';
    } else if (o.status === 'partial_paid' && !firstPaymentAcknowledged) {
      bucket = Number(o.paidAmount) > EPS ? 'pending' : 'unpaid';
    } else if (o.status === 'confirmed') {
      bucket = 'confirmed';
    } else {
      bucket = 'unpaid';
    }
    out.push({
      key: 'initial',
      kind: 'initial',
      bucket,
      amount: initialAmt,
      lines: initialLines,
    });
  }

  for (const b of appendBatches) {
    out.push(appendGroupFromBatch(o, b, pendingIds));
  }

  return out;
}

function appendGroupFromBatch(
  o: OrderDoc,
  b: OrderAppendBatchDoc,
  pendingIds: string[]
): OrderPaymentGroup {
  const amt = Number(b.deltaAmount) || 0;
  if (b.confirmedAt) {
    return {
      key: `append:${b.id}`,
      kind: 'append',
      batchId: b.id,
      bucket: 'confirmed',
      amount: amt,
      lines: b.lines,
    };
  }
  const canConfirm = canMerchantConfirmAppendBatchByScreenshots(
    o.paymentScreenshots,
    b.id,
    pendingIds,
    b.appendedAt
  );
  return {
    key: `append:${b.id}`,
    kind: 'append',
    batchId: b.id,
    bucket: canConfirm ? 'pending' : 'unpaid',
    amount: amt,
    lines: b.lines,
  };
}

export type BucketSelection = Record<GroupBucket, boolean>;

export const DEFAULT_BUCKET_SELECTION: BucketSelection = {
  confirmed: true,
  pending: true,
  unpaid: true,
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
  if (o.status === 'unpaid') return true;
  if ((Number(o.pendingAmount) || 0) > EPS) return true;
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
