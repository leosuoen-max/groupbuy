import type { MockDeliveryPoint } from '../types/orderDraft';

function addressMatchNeedles(address: string): string[] {
  const raw = address.trim().toLowerCase();
  if (!raw) return [];
  const tokens = raw.split(/[\s,，、;；/|]+/).filter((t) => t.length >= 2);
  const bigrams: string[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const bi = raw.slice(i, i + 2);
    if (/[\u4e00-\u9fff]{2}/.test(bi) || /\d{2}/.test(bi)) {
      bigrams.push(bi);
    }
  }
  return [...new Set([...tokens, ...bigrams])];
}

function scoreDeliveryPoint(address: string, point: MockDeliveryPoint): number {
  const needles = addressMatchNeedles(address);
  if (needles.length === 0) return 0;
  const blob = `${point.name} ${point.detailAddress ?? ''} ${
    point.deliveryTime ?? ''
  }`.toLowerCase();
  let score = 0;
  for (const n of needles) {
    if (n.length < 2) continue;
    if (blob.includes(n)) score += n.length;
  }
  return score;
}

/**
 * 根据用户填写的地址，从候选配送点中列出可能匹配项（关键词命中）。
 * 无足够命中时返回空数组，避免乱推荐。
 */
export function suggestDeliveryPointsFromAddress(
  address: string,
  points: MockDeliveryPoint[]
): MockDeliveryPoint[] {
  const raw = address.trim().toLowerCase();
  if (!raw || points.length === 0) return [];

  return points
    .map((point) => ({ point, score: scoreDeliveryPoint(raw, point) }))
    .filter((row) => row.score >= 4)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.point.name.localeCompare(b.point.name, 'zh-CN');
    })
    .map((row) => row.point);
}

/**
 * 兼容旧调用：返回最佳单项。
 */
export function suggestDeliveryPointFromAddress(
  address: string,
  points: MockDeliveryPoint[]
): MockDeliveryPoint | null {
  return suggestDeliveryPointsFromAddress(address, points)[0] ?? null;
}
