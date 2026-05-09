import type { Timestamp } from 'firebase/firestore';
import type { BundleToolDoc, ProjectProduct } from '../types/firestore';

function isFirestoreScheduledOffPast(
  scheduledOffAt: Timestamp | null | undefined,
  nowMs: number
): boolean {
  if (!scheduledOffAt || typeof scheduledOffAt.toMillis !== 'function') return false;
  return nowMs >= scheduledOffAt.toMillis();
}

/** 定时下架是否已到点（未设置则 false） */
export function isProductPastScheduledOff(
  p: Pick<ProjectProduct, 'scheduledOffAt'>,
  nowMs: number = Date.now()
): boolean {
  return isFirestoreScheduledOffPast(p.scheduledOffAt ?? undefined, nowMs);
}

/** 套餐工具定时下架是否已到点 */
export function isBundleToolPastScheduledOff(
  tool: Pick<BundleToolDoc, 'scheduledOffAt'>,
  nowMs: number = Date.now()
): boolean {
  return isFirestoreScheduledOffPast(tool.scheduledOffAt ?? undefined, nowMs);
}

/** 顾客端是否仍可展示/购买该商品（含定时下架） */
export function isProjectProductSellable(p: ProjectProduct, now: Date): boolean {
  if (!p.isActive) return false;
  if (isProductPastScheduledOff(p, now.getTime())) return false;
  return true;
}

/** Mock 顾客端商品（scheduledOffAt 为 ISO 字符串） */
export function isMockProductSellable(
  p: { isActive: boolean; scheduledOffAt?: string },
  now: Date
): boolean {
  if (!p.isActive) return false;
  if (p.scheduledOffAt) {
    const end = new Date(p.scheduledOffAt).getTime();
    if (now.getTime() >= end) return false;
  }
  return true;
}
