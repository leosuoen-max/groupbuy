import { describe, expect, it } from 'vitest';
import type { RecurringDeliveryScheduleDoc } from '../types/firestore';
import {
  buildPaymentWindows,
  listSelectableDeliverySlots,
  resolveSlotFromPaymentTime,
} from './recurringDeliverySchedule';

function baseSchedule(
  partial: Partial<RecurringDeliveryScheduleDoc> = {}
): RecurringDeliveryScheduleDoc {
  return {
    salesStartDate: '2026-05-14',
    salesEndDate: '2026-05-16',
    firstDeliveryDate: '2026-05-16',
    firstDeliveryPeriod: 'midday',
    lastDeliveryDate: '2026-05-16',
    lastDeliveryPeriod: 'evening',
    frequency: 'twice_daily',
    middayCutoffTime: '10:00',
    eveningCutoffTime: '15:00',
    ...partial,
  };
}

describe('resolveSlotFromPaymentTime twice_daily', () => {
  const schedule = baseSchedule();

  it('before 10:00 on 5/16 → 5/16 midday', () => {
    const slot = resolveSlotFromPaymentTime(
      new Date(2026, 4, 16, 9, 30, 0),
      schedule
    );
    expect(slot).toEqual({ date: '2026-05-16', period: 'midday' });
  });

  it('14:00 on 5/16 → 5/16 evening', () => {
    const slot = resolveSlotFromPaymentTime(
      new Date(2026, 4, 16, 14, 0, 0),
      schedule
    );
    expect(slot).toEqual({ date: '2026-05-16', period: 'evening' });
  });

  it('16:00 on 5/16 → null (past last cutoff)', () => {
    const slot = resolveSlotFromPaymentTime(
      new Date(2026, 4, 16, 16, 0, 0),
      schedule
    );
    expect(slot).toBeNull();
  });
});

describe('resolveSlotFromPaymentTime once_daily evening', () => {
  const schedule = baseSchedule({
    frequency: 'once_daily',
    onceDailyPeriod: 'evening',
    firstDeliveryPeriod: 'evening',
    lastDeliveryPeriod: 'evening',
    eveningCutoffTime: '13:00',
    lastDeliveryDate: '2026-05-17',
  });

  it('today noon → today evening', () => {
    const slot = resolveSlotFromPaymentTime(
      new Date(2026, 4, 16, 12, 0, 0),
      schedule
    );
    expect(slot).toEqual({ date: '2026-05-16', period: 'evening' });
  });

  it('today 14:00 → tomorrow evening', () => {
    const slot = resolveSlotFromPaymentTime(
      new Date(2026, 4, 16, 14, 0, 0),
      schedule
    );
    expect(slot).toEqual({ date: '2026-05-17', period: 'evening' });
  });
});

describe('buildPaymentWindows', () => {
  it('twice_daily single day has two windows', () => {
    const windows = buildPaymentWindows(baseSchedule());
    expect(windows).toHaveLength(2);
    expect(windows[0]!.slot.period).toBe('midday');
    expect(windows[1]!.slot.period).toBe('evening');
  });
});

describe('listSelectableDeliverySlots', () => {
  const schedule = baseSchedule();

  it('includes all slots whose cutoff has not passed', () => {
    const at930 = new Date(2026, 4, 16, 9, 30, 0);
    expect(listSelectableDeliverySlots(schedule, at930)).toEqual([
      { date: '2026-05-16', period: 'midday' },
      { date: '2026-05-16', period: 'evening' },
    ]);
  });

  it('excludes slots after their cutoff time', () => {
    const at1400 = new Date(2026, 4, 16, 14, 0, 0);
    expect(listSelectableDeliverySlots(schedule, at1400)).toEqual([
      { date: '2026-05-16', period: 'evening' },
    ]);
  });

  it('returns empty after project closes', () => {
    const at1600 = new Date(2026, 4, 16, 16, 0, 0);
    expect(listSelectableDeliverySlots(schedule, at1600)).toEqual([]);
  });
});
