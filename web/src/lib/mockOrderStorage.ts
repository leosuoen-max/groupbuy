import type { StoredMockOrder } from '../types/orderDraft';

const KEY = 'groupbuy_mock_orders_v1';

function safeParse(raw: string | null): StoredMockOrder[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as StoredMockOrder[]) : [];
  } catch {
    return [];
  }
}

export function loadMockOrders(): StoredMockOrder[] {
  if (typeof sessionStorage === 'undefined') return [];
  return safeParse(sessionStorage.getItem(KEY));
}

export function saveMockOrder(order: StoredMockOrder): void {
  if (typeof sessionStorage === 'undefined') return;
  const next = [order, ...loadMockOrders()];
  sessionStorage.setItem(KEY, JSON.stringify(next));
}

export function findMockOrder(
  shopSlug: string,
  projectId: string,
  orderNumber: string
): StoredMockOrder | undefined {
  return loadMockOrders().find(
    (o) =>
      o.shopSlug === shopSlug &&
      o.projectId === projectId &&
      o.orderNumber === orderNumber
  );
}
