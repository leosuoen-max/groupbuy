import type { Timestamp } from 'firebase/firestore';

/** 解析订单里的 paymentScreenshots（兼容未知结构） */
export function parseScreenshotEntries(raw: unknown): {
  id: string | null;
  url: string | null;
  uploadedAt: Timestamp | null;
  flag: 'green' | 'yellow' | 'red' | null;
  flagReason: string | null;
}[] {
  if (!Array.isArray(raw)) return [];
  const out: {
    id: string | null;
    url: string | null;
    uploadedAt: Timestamp | null;
    flag: 'green' | 'yellow' | 'red' | null;
    flagReason: string | null;
  }[] = [];
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
    out.push({ id, url, uploadedAt, flag, flagReason });
  }
  return out;
}

export function orderHasPaymentScreenshots(raw: unknown): boolean {
  return parseScreenshotEntries(raw).some((x) => x.url);
}
