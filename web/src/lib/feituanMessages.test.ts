import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderRow } from './orderService';
import type { OrderDoc } from '../types/firestore';
import {
  computeFeituanTabBadgeFromRows,
  countFeituanPaymentTodos,
  countUnreadNotifies,
  listFeituanMessages,
  loadSeenNotifyOrderIds,
  markNotifyOrderIdsSeen,
  partitionFeituanMessages,
  shouldShowOrangeMarker,
} from './feituanMessages';

function row(id: string, data: Partial<OrderDoc>): OrderRow {
  return { id, data: data as unknown as OrderDoc };
}

function mockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    clear: () => store.clear(),
  };
}

describe('feituanMessages', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage());
  });

  it('classifies payment todo vs notify', () => {
    const unpaid = row('a', {
      status: 'unpaid',
      orderNumber: '1',
      projectId: 'p',
      totalAmount: 10,
      pendingAmount: 10,
      paymentScreenshots: [],
    });
    const pending = row('b', {
      status: 'pending',
      orderNumber: '2',
      projectId: 'p',
      totalAmount: 10,
      pendingAmount: 0,
      paymentScreenshots: [{ url: 'https://x/1.jpg', uploadedAt: 1 }],
    });

    const items = listFeituanMessages([unpaid, pending]);
    const { todos, notifies } = partitionFeituanMessages(items);
    expect(todos).toHaveLength(1);
    expect(todos[0]!.orderId).toBe('a');
    expect(notifies).toHaveLength(1);
    expect(notifies[0]!.orderId).toBe('b');
  });

  it('counts partial paid with pending as todo', () => {
    const partial = row('c', {
      status: 'partial_paid',
      orderNumber: '3',
      projectId: 'p',
      totalAmount: 30,
      pendingAmount: 12,
      paidAmount: 18,
      paymentScreenshots: [{ url: 'https://x/2.jpg', uploadedAt: 1 }],
    });
    const items = listFeituanMessages([partial]);
    expect(items[0]!.kind).toBe('todo');
    expect(items[0]!.title).toContain('尾款');
    expect(countFeituanPaymentTodos([partial.data])).toBe(1);
  });

  it('badge = todos + unread notifies', () => {
    const rows = [
      row('todo1', {
        status: 'unpaid',
        orderNumber: '1',
        projectId: 'p',
        totalAmount: 20,
        pendingAmount: 20,
        paymentScreenshots: [],
      }),
      row('notify1', {
        status: 'pending',
        orderNumber: '2',
        projectId: 'p',
        totalAmount: 20,
        pendingAmount: 0,
        paymentScreenshots: [{ url: 'https://x/a.jpg', uploadedAt: 1 }],
      }),
    ];
    expect(computeFeituanTabBadgeFromRows(rows, 'cust1')).toBe(2);
    markNotifyOrderIdsSeen('cust1', ['notify1']);
    expect(computeFeituanTabBadgeFromRows(rows, 'cust1')).toBe(1);
  });

  it('orange marker: todo always, notify only when unread', () => {
    const notify = {
      orderId: 'n1',
      order: {} as OrderDoc,
      title: 't',
      body: 'b',
      href: '/',
      kind: 'notify' as const,
    };
    const todo = { ...notify, orderId: 't1', kind: 'todo' as const };
    const seen = loadSeenNotifyOrderIds('c');
    expect(shouldShowOrangeMarker(todo, seen)).toBe(true);
    expect(shouldShowOrangeMarker(notify, seen)).toBe(true);
    markNotifyOrderIdsSeen('c', ['n1']);
    const seen2 = loadSeenNotifyOrderIds('c');
    expect(shouldShowOrangeMarker(notify, seen2)).toBe(false);
    expect(countUnreadNotifies([notify], seen2)).toBe(0);
  });
});
