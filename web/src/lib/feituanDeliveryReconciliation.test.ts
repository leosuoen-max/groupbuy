import { describe, expect, it } from 'vitest';
import {
  buildDeliveryManifest,
  formatDeliverySlotParamKey,
  orderMatchesDeliverySlotKey,
  resolveDeliveryPointGroup,
} from './feituanDeliveryReconciliation';
import { DEFAULT_BUCKET_SELECTION } from './reconciliationGroups';
import type { OrderDoc } from '../types/firestore';
import type { OrderRow } from './orderService';

function orderRow(partial: Partial<OrderDoc> & Pick<OrderDoc, 'orderNumber'>): OrderRow {
  return {
    id: partial.orderNumber,
    data: {
      status: 'confirmed',
      deliveryPointSnapshot: { name: '快照点' },
      lines: [],
      totalAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
      isManualMatch: false,
      paymentScreenshots: [],
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      projectId: 'p1',
      projectTitle: '项目',
      ...partial,
    } as OrderDoc,
  };
}

describe('feituanDeliveryReconciliation', () => {
  it('matches delivery slot key', () => {
    const key = formatDeliverySlotParamKey('2025-05-18', 'midday');
    expect(
      orderMatchesDeliverySlotKey(
        { deliverySlot: { date: '2025-05-18', period: 'midday', label: 'x' } },
        key
      )
    ).toBe(true);
    expect(
      orderMatchesDeliverySlotKey(
        { deliverySlot: { date: '2025-05-18', period: 'evening', label: 'x' } },
        key
      )
    ).toBe(false);
  });

  it('unknown delivery point id goes to 未知配送点', () => {
    const g = resolveDeliveryPointGroup(
      orderRow({
        orderNumber: '1',
        deliveryPointId: 'missing-id',
      }).data,
      new Map()
    );
    expect(g.zoneName).toBe('未知配送点');
  });

  it('manifest only includes zones with orders', () => {
    const pointById = new Map([
      [
        'feituan:z1:pt1',
        {
          id: 'feituan:z1:pt1',
          name: '甲点',
          code: 'A1',
          zoneId: 'z1',
          zoneName: 'A 区',
        },
      ],
    ]);
    const rows = [
      orderRow({
        orderNumber: '1',
        deliveryPointId: 'feituan:z1:pt1',
        deliverySlot: { date: '2025-05-18', period: 'midday', label: '档' },
      }),
    ];
    const zones = buildDeliveryManifest(rows, DEFAULT_BUCKET_SELECTION, pointById);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.zoneName).toBe('A 区');
    expect(zones[0]!.orderCount).toBe(1);
    expect(zones[0]!.points[0]!.orderCount).toBe(1);
  });
});
