import { deriveDisplayOrderStatus } from './paymentGroupView';
import { orderHasPaymentScreenshots } from './paymentScreenshotHelpers';
import { formatMYR } from './formatMYR';
import type { OrderRow } from './orderService';
import type { OrderDoc } from '../types/firestore';

export type FeituanMessageKind = 'todo' | 'notify';

export type FeituanMessageItem = {
  orderId: string;
  order: OrderDoc;
  title: string;
  body: string;
  href: string;
  kind: FeituanMessageKind;
};

const SEEN_NOTIFY_STORAGE_PREFIX = 'feituan-messages-seen-notify:v1:';

export function seenNotifyStorageKey(customerKey: string): string {
  return `${SEEN_NOTIFY_STORAGE_PREFIX}${customerKey}`;
}

export function loadSeenNotifyOrderIds(customerKey: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(seenNotifyStorageKey(customerKey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { orderIds?: string[] };
    return new Set(parsed.orderIds ?? []);
  } catch {
    return new Set();
  }
}

export function markNotifyOrderIdsSeen(customerKey: string, orderIds: string[]): void {
  if (typeof localStorage === 'undefined' || orderIds.length === 0) return;
  const prev = loadSeenNotifyOrderIds(customerKey);
  for (const id of orderIds) prev.add(id);
  localStorage.setItem(
    seenNotifyStorageKey(customerKey),
    JSON.stringify({ orderIds: [...prev] })
  );
}

/** 待办：待付款 / 待付尾款（含 partial + pendingAmount） */
export function isFeituanPaymentTodo(order: OrderDoc): boolean {
  if (order.status === 'cancelled') return false;
  const display = deriveDisplayOrderStatus(order);
  const pending = Number(order.pendingAmount ?? 0);
  const hasShot = orderHasPaymentScreenshots(order.paymentScreenshots);
  const needsPay =
    display === 'unpaid' ||
    display === 'partial_paid' ||
    (pending > 0.0001 && display !== 'confirmed');
  if (!needsPay) return false;
  if (!hasShot) return true;
  return pending > 0.0001;
}

export function buildFeituanMessageItem(row: OrderRow): FeituanMessageItem | null {
  const o = row.data;
  if (o.status === 'cancelled') return null;
  const display = deriveDisplayOrderStatus(o);
  const pending = Number(o.pendingAmount ?? 0);
  const hasShot = orderHasPaymentScreenshots(o.paymentScreenshots);
  const href = `/feituan/projects/${encodeURIComponent(o.projectId)}/orders/${encodeURIComponent(o.orderNumber)}`;

  if (isFeituanPaymentTodo(o)) {
    if (!hasShot) {
      return {
        orderId: row.id,
        order: o,
        title: `订单 #${o.orderNumber} 待付款`,
        body: `${o.projectTitle || '饭团项目'} · 待付 ${formatMYR(pending > 0 ? pending : o.totalAmount)}，请付款或上传截图`,
        href,
        kind: 'todo',
      };
    }
    return {
      orderId: row.id,
      order: o,
      title: `订单 #${o.orderNumber} 待付尾款`,
      body: `${o.projectTitle || '饭团项目'} · 仍有 ${formatMYR(pending)} 待付`,
      href,
      kind: 'todo',
    };
  }

  if (display === 'pending' && hasShot) {
    return {
      orderId: row.id,
      order: o,
      title: `订单 #${o.orderNumber} 待确认`,
      body: `${o.projectTitle || '饭团项目'} · 已传付款截图，等待确认`,
      href,
      kind: 'notify',
    };
  }

  return null;
}

export function listFeituanMessages(rows: OrderRow[]): FeituanMessageItem[] {
  return rows.map(buildFeituanMessageItem).filter((x): x is FeituanMessageItem => Boolean(x));
}

export function partitionFeituanMessages(items: FeituanMessageItem[]): {
  todos: FeituanMessageItem[];
  notifies: FeituanMessageItem[];
} {
  const todos: FeituanMessageItem[] = [];
  const notifies: FeituanMessageItem[] = [];
  for (const item of items) {
    if (item.kind === 'todo') todos.push(item);
    else notifies.push(item);
  }
  return { todos, notifies };
}

export function countFeituanPaymentTodos(orders: OrderDoc[]): number {
  let n = 0;
  for (const o of orders) {
    if (isFeituanPaymentTodo(o)) n += 1;
  }
  return n;
}

export function countUnreadNotifies(
  notifies: FeituanMessageItem[],
  seenOrderIds: Set<string>
): number {
  return notifies.filter((n) => !seenOrderIds.has(n.orderId)).length;
}

export function shouldShowOrangeMarker(
  item: FeituanMessageItem,
  seenNotifyOrderIds: Set<string>
): boolean {
  if (item.kind === 'todo') return true;
  return !seenNotifyOrderIds.has(item.orderId);
}

export function computeFeituanTabBadgeFromRows(
  rows: OrderRow[],
  customerKey: string
): number {
  const items = listFeituanMessages(rows);
  const { todos, notifies } = partitionFeituanMessages(items);
  const seen = loadSeenNotifyOrderIds(customerKey);
  return todos.length + countUnreadNotifies(notifies, seen);
}
