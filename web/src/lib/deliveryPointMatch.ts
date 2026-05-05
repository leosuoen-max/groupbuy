import type { MockDeliveryPoint } from '../types/orderDraft';

/**
 * 根据用户填写的地址，从候选配送点中推测最可能的一项（关键词命中）。
 * 无足够命中时返回 null，避免乱推荐。
 */
export function suggestDeliveryPointFromAddress(
  address: string,
  points: MockDeliveryPoint[]
): MockDeliveryPoint | null {
  const raw = address.trim().toLowerCase();
  if (!raw || points.length === 0) return null;

  const tokens = raw.split(/[\s,，、;；/|]+/).filter((t) => t.length >= 2);
  const bigrams: string[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const bi = raw.slice(i, i + 2);
    if (/[\u4e00-\u9fff]{2}/.test(bi) || /\d{2}/.test(bi)) {
      bigrams.push(bi);
    }
  }
  const needles = [...new Set([...tokens, ...bigrams])];

  let best: MockDeliveryPoint | null = null;
  let bestScore = 0;

  for (const p of points) {
    const blob = `${p.name} ${p.detailAddress ?? ''} ${p.deliveryTime ?? ''}`.toLowerCase();
    let score = 0;
    for (const n of needles) {
      if (n.length < 2) continue;
      if (blob.includes(n)) score += n.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (bestScore >= 4 && best) return best;
  return null;
}
