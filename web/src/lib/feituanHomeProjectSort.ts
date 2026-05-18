import type { ProjectRow } from './projectService';
import { getProjectLastDeliverySlot } from './deliverySlot';
import { compareDeliverySlots } from './recurringDeliverySchedule';

function feituanListedAtMs(row: ProjectRow): number {
  return (
    row.data.feituanReviewedAt?.toMillis?.() ??
    row.data.feituanSubmittedAt?.toMillis?.() ??
    0
  );
}

/** 饭团主页：最后配送档越早越靠前；同档按批准上架时间先后（先批准在上） */
export function compareFeituanHomeProjects(a: ProjectRow, b: ProjectRow): number {
  const slotA = getProjectLastDeliverySlot(a.data);
  const slotB = getProjectLastDeliverySlot(b.data);

  if (slotA && slotB) {
    const bySlot = compareDeliverySlots(slotA, slotB);
    if (bySlot !== 0) return bySlot;
  } else if (slotA && !slotB) {
    return -1;
  } else if (!slotA && slotB) {
    return 1;
  }

  return feituanListedAtMs(a) - feituanListedAtMs(b);
}
