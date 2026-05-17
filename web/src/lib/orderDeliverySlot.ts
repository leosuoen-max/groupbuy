import {
  Timestamp,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore';
import type { OrderDoc, ProjectDoc } from '../types/firestore';
import {
  buildOrderDeliverySlotSnapshot,
  type ProjectDeliverySlot,
} from './deliverySlot';
import {
  getRecurringSchedule,
  isProjectRecurring,
  resolveSlotFromPaymentTime,
} from './recurringDeliverySchedule';

export function hasOrderDeliverySlotLocked(
  order: Pick<OrderDoc, 'deliverySlot'>
): boolean {
  return Boolean(order.deliverySlot?.date && order.deliverySlot?.period);
}

/** 首次付款动作：计算并返回配送档快照（长期项目） */
export function resolveAndBuildDeliverySlotSnapshot(
  project: ProjectDoc,
  paymentAt: Date
): { date: string; period: 'midday' | 'evening'; label: string } | null {
  if (!isProjectRecurring(project)) return null;
  const schedule = getRecurringSchedule(project);
  if (!schedule) return null;
  const slot = resolveSlotFromPaymentTime(paymentAt, schedule);
  if (!slot) return null;
  return buildOrderDeliverySlotSnapshot(slot);
}

export async function lockOrderDeliverySlotIfNeeded(
  orderRef: DocumentReference,
  order: OrderDoc,
  project: ProjectDoc,
  paymentAt: Date
): Promise<ProjectDeliverySlot | null> {
  if (!isProjectRecurring(project)) return null;
  if (hasOrderDeliverySlotLocked(order)) {
    return {
      date: order.deliverySlot!.date,
      period: order.deliverySlot!.period,
    };
  }
  const snapshot = resolveAndBuildDeliverySlotSnapshot(project, paymentAt);
  if (!snapshot) {
    throw new Error('当前时间已超过项目截单，无法完成付款');
  }
  await updateDoc(orderRef, {
    deliverySlot: snapshot,
    updatedAt: Timestamp.now(),
  });
  return { date: snapshot.date, period: snapshot.period };
}
