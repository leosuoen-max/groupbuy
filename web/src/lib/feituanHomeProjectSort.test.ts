import { describe, expect, it } from 'vitest';
import type { ProjectDoc } from '../types/firestore';
import type { ProjectRow } from './projectService';
import { compareFeituanHomeProjects } from './feituanHomeProjectSort';

function row(id: string, patch: Partial<ProjectDoc> = {}): ProjectRow {
  const base: ProjectDoc = {
    shopId: 's1',
    title: id,
    status: 'published',
    closesAt: { toMillis: () => 0 } as ProjectDoc['closesAt'],
    products: [],
    deliveryPointIds: [],
    formFields: {
      name: { required: true },
      phone: { required: true },
      address: { required: true },
      note: { required: false },
    },
    orderSettings: {
      maxOrdersPerCustomer: null,
      visibility: 'all',
      allowEdit: false,
      allowCancel: false,
    },
    stats: {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    },
    createdAt: { toMillis: () => 0 } as ProjectDoc['createdAt'],
    updatedAt: { toMillis: () => 0 } as ProjectDoc['updatedAt'],
    feituanStatus: 'listed',
    ...patch,
  };
  return { id, data: base };
}

describe('compareFeituanHomeProjects', () => {
  it('sorts by last delivery slot ascending', () => {
    const early = row('a', {
      deliveryDate: '2026-05-18',
      deliveryPeriod: 'midday',
      feituanReviewedAt: { toMillis: () => 2000 } as ProjectDoc['feituanReviewedAt'],
    });
    const late = row('b', {
      deliveryDate: '2026-05-20',
      deliveryPeriod: 'evening',
      feituanReviewedAt: { toMillis: () => 1000 } as ProjectDoc['feituanReviewedAt'],
    });
    expect(compareFeituanHomeProjects(early, late)).toBeLessThan(0);
    expect([late, early].sort(compareFeituanHomeProjects).map((x) => x.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('same slot sorts by feituanReviewedAt ascending', () => {
    const first = row('first', {
      deliveryDate: '2026-05-18',
      deliveryPeriod: 'midday',
      feituanReviewedAt: { toMillis: () => 1000 } as ProjectDoc['feituanReviewedAt'],
    });
    const second = row('second', {
      deliveryDate: '2026-05-18',
      deliveryPeriod: 'midday',
      feituanReviewedAt: { toMillis: () => 2000 } as ProjectDoc['feituanReviewedAt'],
    });
    expect([second, first].sort(compareFeituanHomeProjects).map((x) => x.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('recurring uses lastDeliveryDate/Period', () => {
    const recurring = row('r', {
      projectKind: 'recurring',
      recurringSchedule: {
        salesStartDate: '2026-05-01',
        salesEndDate: '2026-05-25',
        firstDeliveryDate: '2026-05-10',
        firstDeliveryPeriod: 'midday',
        lastDeliveryDate: '2026-05-19',
        lastDeliveryPeriod: 'midday',
        frequency: 'once_daily',
        onceDailyPeriod: 'midday',
        middayCutoffTime: '10:00',
      },
      feituanReviewedAt: { toMillis: () => 5000 } as ProjectDoc['feituanReviewedAt'],
    });
    const temp = row('t', {
      deliveryDate: '2026-05-20',
      deliveryPeriod: 'midday',
      feituanReviewedAt: { toMillis: () => 1000 } as ProjectDoc['feituanReviewedAt'],
    });
    expect([temp, recurring].sort(compareFeituanHomeProjects).map((x) => x.id)).toEqual([
      'r',
      't',
    ]);
  });
});
