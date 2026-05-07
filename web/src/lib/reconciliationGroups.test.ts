import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { OrderDoc } from '../types/firestore';
import {
  deliveryPointLabel,
  listOrderPaymentGroups,
  scopedGroupAmount,
} from './reconciliationGroups';

const line = (
  name: string,
  sub: number
): OrderDoc['lines'][number] => ({
  productId: 'p',
  name,
  quantity: 1,
  unitPrice: sub,
  isDiscount: false,
  subtotal: sub,
});

function baseOrder(over: Partial<OrderDoc>): OrderDoc {
  const now = Timestamp.now();
  return {
    orderNumber: 'T1',
    shopId: 's1',
    shopSlug: 'shop',
    projectId: 'proj',
    projectTitle: '项目',
    customerKey: 'k',
    customerName: '顾客',
    customerPhone: '',
    customerAddress: '',
    lines: [line('饭', 10)],
    initialLines: [line('饭', 10)],
    initialTotalAmount: 10,
    totalAmount: 10,
    paidAmount: 0,
    pendingAmount: 10,
    deliveryPointSnapshot: { name: 'A 点' },
    isManualMatch: false,
    paymentScreenshots: [],
    status: 'unpaid',
    internalNotes: [],
    statusHistory: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('deliveryPointLabel', () => {
  it('uses 未指定配送点 when name empty', () => {
    const o = baseOrder({ deliveryPointSnapshot: { name: '' } });
    expect(deliveryPointLabel(o)).toBe('未指定配送点');
  });

  it('trims snapshot name', () => {
    const o = baseOrder({ deliveryPointSnapshot: { name: '  B  ' } });
    expect(deliveryPointLabel(o)).toBe('B');
  });
});

describe('listOrderPaymentGroups', () => {
  it('single initial unpaid order has one unpaid group', () => {
    const o = baseOrder({ status: 'unpaid' });
    const g = listOrderPaymentGroups(o);
    expect(g).toHaveLength(1);
    expect(g[0]!.bucket).toBe('unpaid');
    expect(g[0]!.amount).toBe(10);
  });

  it('pending order has initial pending group', () => {
    const o = baseOrder({ status: 'pending' });
    const g = listOrderPaymentGroups(o);
    expect(g[0]!.bucket).toBe('pending');
  });

  it('partial_paid with confirmed initial and unconfirmed append splits buckets', () => {
    const t0 = Timestamp.fromMillis(1_700_000_000_000);
    const t1 = Timestamp.fromMillis(1_700_000_060_000);
    const o = baseOrder({
      status: 'partial_paid',
      totalAmount: 25,
      paidAmount: 10,
      pendingAmount: 15,
      initialPaymentConfirmedAt: t0,
      appendBatches: [
        {
          id: 'b1',
          appendedAt: t1,
          lines: [line('加菜', 15)],
          deltaAmount: 15,
        },
      ],
      paymentScreenshots: [
        {
          id: 'shot1',
          url: 'https://example.com/p.jpg',
          uploadedAt: t1,
          flag: 'green',
          appendBatchId: 'b1',
        },
      ],
    });
    const g = listOrderPaymentGroups(o);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.kind === 'initial')!.bucket).toBe('confirmed');
    const append = g.find((x) => x.batchId === 'b1')!;
    expect(append.bucket).toBe('pending');
    expect(append.amount).toBe(15);
  });
});

describe('scopedGroupAmount', () => {
  it('sums only selected buckets', () => {
    const o = baseOrder({
      status: 'partial_paid',
      totalAmount: 25,
      paidAmount: 10,
      pendingAmount: 15,
      initialPaymentConfirmedAt: Timestamp.now(),
      appendBatches: [
        {
          id: 'b1',
          appendedAt: Timestamp.fromMillis(1_700_000_060_000),
          lines: [line('加', 15)],
          deltaAmount: 15,
        },
      ],
      paymentScreenshots: [],
    });
    const groups = listOrderPaymentGroups(o);
    const onlyUnpaid = scopedGroupAmount(groups, {
      confirmed: false,
      pending: false,
      unpaid: true,
    });
    expect(onlyUnpaid).toBe(15);
  });
});
