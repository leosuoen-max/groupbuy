import { OTHER_DELIVERY_ID } from '../data/mockDeliveryPoints';
import type { MockDeliveryPoint } from '../types/orderDraft';
import type { OrderDoc } from '../types/firestore';

/** 与下单页一致的「仅配送点」占位地址文案，用于判断是否还要单独展示一行地址 */
export function expectedSyntheticCustomerAddress(order: OrderDoc): string | null {
  const n = order.deliveryPointSnapshot?.name?.trim();
  if (!n) return null;
  const d = order.deliveryPointSnapshot?.detail?.trim();
  return d ? `配送点：${n} · ${d}` : `配送点：${n}`;
}

/** 选择了具体配送点时的 resolved 地址（与 OrderForm 一致） */
export function resolveCustomerAddressForChoice(
  deliveryId: string,
  addressInput: string,
  points: MockDeliveryPoint[]
): string {
  const line = addressInput.trim();
  if (line) return line;
  if (deliveryId && deliveryId !== OTHER_DELIVERY_ID) {
    const p = points.find((x) => x.id === deliveryId);
    if (p) {
      const bits = [p.name, p.detailAddress].filter(Boolean);
      return bits.length ? `配送点：${bits.join(' · ')}` : `配送点：${p.name}`;
    }
  }
  return '';
}

/** 修改联系信息表单里「地址」输入框的预填（配送点单且仅为系统占位时不重复展示长串） */
export function addressFieldPrefillForContactEdit(order: OrderDoc): string {
  if (order.deliveryPointId && !order.isManualMatch) {
    const syn = expectedSyntheticCustomerAddress(order);
    const addr = order.customerAddress?.trim() ?? '';
    if (syn && addr === syn) return '';
    return addr;
  }
  return order.customerAddress?.trim() ?? '';
}

/** 顾客详情页：是否应在配送点下方单独展示一行地址 */
export function showExtraAddressUnderDeliveryPoint(order: OrderDoc): boolean {
  if (!order.deliveryPointId || order.isManualMatch) return false;
  const addr = order.customerAddress?.trim() ?? '';
  if (!addr) return false;
  const syn = expectedSyntheticCustomerAddress(order);
  if (!syn) return true;
  return addr !== syn;
}
