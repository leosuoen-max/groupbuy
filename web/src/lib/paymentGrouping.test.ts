import { describe, expect, it } from 'vitest';
import { orderHasNoPaymentActionYet } from './paymentGrouping';

function ts(ms: number) {
  return { toMillis: () => ms } as any;
}

describe('orderHasNoPaymentActionYet', () => {
  it('returns true for unpaid + append without any proof', () => {
    const ok = orderHasNoPaymentActionYet({
      status: 'unpaid',
      initialPaymentConfirmedAt: undefined,
      appendBatches: [{ id: 'b1', confirmedAt: undefined } as any],
      paymentScreenshots: [],
    });
    expect(ok).toBe(true);
  });

  it('returns false when waived proof exists', () => {
    const ok = orderHasNoPaymentActionYet({
      status: 'unpaid',
      initialPaymentConfirmedAt: undefined,
      appendBatches: [{ id: 'b1', confirmedAt: undefined } as any],
      paymentScreenshots: [{ waivedNoScreenshot: true, uploadedAt: ts(1) }],
    });
    expect(ok).toBe(false);
  });

  it('returns false when any segment already confirmed', () => {
    const ok = orderHasNoPaymentActionYet({
      status: 'partial_paid',
      initialPaymentConfirmedAt: undefined,
      appendBatches: [{ id: 'b1', confirmedAt: ts(2) } as any],
      paymentScreenshots: [],
    });
    expect(ok).toBe(false);
  });
});

