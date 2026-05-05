import type { Timestamp } from 'firebase/firestore';

export type ParsedScreenshotEntry = {
  id: string | null;
  url: string | null;
  uploadedAt: Timestamp | null;
  flag: 'green' | 'yellow' | 'red' | null;
  flagReason: string | null;
  /** 归属某一档加购补款；缺省表示首单/整单付款截图 */
  appendBatchId: string | null;
};

/** 解析订单里的 paymentScreenshots（兼容未知结构） */
export function parseScreenshotEntries(raw: unknown): ParsedScreenshotEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedScreenshotEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id =
      typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
    const url = typeof o.url === 'string' && o.url.trim() ? o.url.trim() : null;
    const ua = o.uploadedAt as Timestamp | undefined;
    const uploadedAt =
      ua && typeof ua.toMillis === 'function' ? ua : null;
    let flag: 'green' | 'yellow' | 'red' | null = null;
    if (o.flag === 'green' || o.flag === 'yellow' || o.flag === 'red') {
      flag = o.flag;
    }
    const flagReason =
      typeof o.flagReason === 'string' ? o.flagReason : null;
    const appendBatchId =
      typeof o.appendBatchId === 'string' && o.appendBatchId.trim()
        ? o.appendBatchId.trim()
        : null;
    out.push({ id, url, uploadedAt, flag, flagReason, appendBatchId });
  }
  return out;
}

export function orderHasPaymentScreenshots(raw: unknown): boolean {
  return parseScreenshotEntries(raw).some((x) => x.url);
}

/** 是否已有挂在指定加购批次 id 上的付款截图（有 URL） */
export function hasPaymentScreenshotForAppendBatch(
  raw: unknown,
  appendBatchId: string
): boolean {
  const id = appendBatchId.trim();
  if (!id) return false;
  return parseScreenshotEntries(raw).some(
    (x) => Boolean(x.url) && x.appendBatchId === id
  );
}

/** 未挂批次的图是否算作「该档加购」：上传时间不得早于本档 opened（appendBatch.appendedAt） */
function untaggedQualifiesAsAppendProofAfterBatchOpened(
  x: ParsedScreenshotEntry,
  notBeforeMs: number
): boolean {
  if (!x.url) return false;
  if (x.appendBatchId != null && x.appendBatchId !== '') return false;
  if (!x.uploadedAt || typeof x.uploadedAt.toMillis !== 'function') {
    return false;
  }
  return x.uploadedAt.toMillis() >= notBeforeMs;
}

/**
 * 该加购批次是否已有顾客上传的付款凭证：挂在该 batchId 的图，或
 * （单笔待确认且上传时间不早于本档 appendedAt 的）未挂批次图——避免把首单旧图算作加购凭证。
 */
export function appendBatchHasCustomerUpload(
  raw: unknown,
  batchId: string,
  batchAppendedAt: Timestamp,
  pendingUnconfirmedBatchIds: string[]
): boolean {
  if (hasPaymentScreenshotForAppendBatch(raw, batchId)) return true;
  const pending = pendingUnconfirmedBatchIds.filter(Boolean);
  if (pending.length !== 1 || pending[0] !== batchId) return false;
  const notBeforeMs = batchAppendedAt.toMillis();
  return parseScreenshotEntries(raw).some((x) =>
    untaggedQualifiesAsAppendProofAfterBatchOpened(x, notBeforeMs)
  );
}

/**
 * 商户是否可确认该笔加购补款：必须有挂在该批次上的截图；
 * 单笔待确认时允许未挂批次图，但须上传时间不早于该档 appendedAt。
 */
export function canMerchantConfirmAppendBatchByScreenshots(
  raw: unknown,
  appendBatchId: string,
  pendingAppendBatchIds: string[],
  batchAppendedAt: Timestamp
): boolean {
  if (hasPaymentScreenshotForAppendBatch(raw, appendBatchId)) return true;
  const pending = pendingAppendBatchIds.filter(Boolean);
  if (pending.length !== 1 || pending[0] !== appendBatchId) return false;
  const notBeforeMs = batchAppendedAt.toMillis();
  return parseScreenshotEntries(raw).some((x) =>
    untaggedQualifiesAsAppendProofAfterBatchOpened(x, notBeforeMs)
  );
}

export type PendingAppendBatchRef = { id: string; appendedAt: Timestamp };

/** 待确认加购：挂批次 id；多笔时未挂批次图须不早于最早一档 appendedAt */
export function canMerchantConfirmPendingAppendLump(
  raw: unknown,
  pendingBatches: PendingAppendBatchRef[]
): boolean {
  const list = pendingBatches.filter((b) => b?.id);
  if (list.length === 0) return false;
  if (list.length === 1) {
    const b = list[0]!;
    return canMerchantConfirmAppendBatchByScreenshots(
      raw,
      b.id,
      [b.id],
      b.appendedAt
    );
  }
  const ids = list.map((b) => b.id);
  const eachTagged = ids.every((id) =>
    hasPaymentScreenshotForAppendBatch(raw, id)
  );
  if (eachTagged) return true;
  const minMs = Math.min(...list.map((b) => b.appendedAt.toMillis()));
  return parseScreenshotEntries(raw).some((x) =>
    untaggedQualifiesAsAppendProofAfterBatchOpened(x, minMs)
  );
}
