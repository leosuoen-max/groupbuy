import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { OrderDoc } from '../types/firestore';
import { buildPaymentGroups } from './paymentGroups';
import { deriveDisplayOrderStatus } from './paymentGroupView';

function baseOrder(overrides: Partial<OrderDoc> = {}): OrderDoc {
  return {
    shopId: 'shop1',
    projectId: 'p1',
    orderNumber: '1001',
    status: 'unpaid',
    totalAmount: 30,
    paidAmount: 0,
    pendingAmount: 30,
    lines: [
      {
        productId: 'a',
        name: 'A',
        quantity: 1,
        unitPrice: 10,
        subtotal: 10,
        isDiscount: false,
      },
    ],
    initialLines: [
      {
        productId: 'a',
        name: 'A',
        quantity: 1,
        unitPrice: 10,
        subtotal: 10,
        isDiscount: false,
      },
    ],
    initialTotalAmount: 10,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    ...overrides,
  } as OrderDoc;
}

describe('deriveDisplayOrderStatus after waive proof', () => {
  it('unpaid order with waived initial proof becomes pending', () => {
    const o = baseOrder({
      paymentScreenshots: [
        {
          id: 'w1',
          uploadedAt: Timestamp.fromMillis(1_700_000_100_000),
          waivedNoScreenshot: true,
          waivedByUserId: 'merchant',
        },
      ],
    });
    const groups = buildPaymentGroups(o);
    expect(groups[0]?.status).toBe('pending');
    expect(deriveDisplayOrderStatus(o, groups)).toBe('pending');
  });

  it('partial_paid order with waived append proof becomes pending', () => {
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
          lines: [
            {
              productId: 'b',
              name: 'B',
              quantity: 1,
              unitPrice: 15,
              subtotal: 15,
              isDiscount: false,
            },
          ],
          deltaAmount: 15,
        },
      ],
      paymentScreenshots: [
        {
          id: 'w1',
          appendBatchId: 'b1',
          uploadedAt: Timestamp.fromMillis(1_700_000_120_000),
          waivedNoScreenshot: true,
          waivedByUserId: 'merchant',
        },
      ],
    });
    const groups = buildPaymentGroups(o);
    expect(groups.some((g) => g.status === 'pending')).toBe(true);
    expect(deriveDisplayOrderStatus(o, groups)).toBe('pending');
  });
});
