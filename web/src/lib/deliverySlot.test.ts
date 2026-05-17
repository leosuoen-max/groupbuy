import { describe, expect, it } from 'vitest';
import {
  formatDeliverySlotLabel,
  inferDeliverySlotFromLegacy,
  parseDeliveryDateLocal,
  resolveProjectDeliverySlot,
} from './deliverySlot';

describe('formatDeliverySlotLabel', () => {
  it('formats date and period with weekday', () => {
    expect(formatDeliverySlotLabel('2026-05-18', 'midday')).toMatch(
      /^5\/18（周[一二三四五六日]）中午$/
    );
    expect(formatDeliverySlotLabel('2026-05-18', 'evening')).toMatch(
      /^5\/18（周[一二三四五六日]）傍晚$/
    );
  });
});

describe('parseDeliveryDateLocal', () => {
  it('rejects invalid calendar dates', () => {
    expect(parseDeliveryDateLocal('2026-02-30')).toBeNull();
    expect(parseDeliveryDateLocal('bad')).toBeNull();
  });
});

describe('inferDeliverySlotFromLegacy', () => {
  it('parses slash date and 中午', () => {
    const slot = inferDeliverySlotFromLegacy('5/18 午餐时间', new Date(2026, 4, 10));
    expect(slot).toEqual({ date: '2026-05-18', period: 'midday' });
  });

  it('parses 傍晚 from legacy text', () => {
    const slot = inferDeliverySlotFromLegacy('5/20 晚餐时间', new Date(2026, 4, 1));
    expect(slot?.period).toBe('evening');
    expect(slot?.date).toBe('2026-05-20');
  });

  it('falls back to closesAt date', () => {
    const slot = inferDeliverySlotFromLegacy('', new Date(2026, 4, 18, 10, 0, 0));
    expect(slot?.date).toBe('2026-05-18');
    expect(slot?.period).toBe('midday');
  });
});

describe('resolveProjectDeliverySlot', () => {
  it('prefers structured fields', () => {
    const slot = resolveProjectDeliverySlot({
      deliveryDate: '2026-06-01',
      deliveryPeriod: 'evening',
      deliveryTimeText: 'old',
    });
    expect(slot).toEqual({ date: '2026-06-01', period: 'evening' });
  });
});
