import { describe, expect, it } from 'vitest';
import { computeWalletTopupScreenshotRiskFlags } from './feituanWalletService';

describe('computeWalletTopupScreenshotRiskFlags', () => {
  it('red when duplicate in other requests', () => {
    const r = computeWalletTopupScreenshotRiskFlags({
      md5Hex: 'abc',
      createdAtMillis: 1000,
      uploadMillis: 2000,
      dupOtherRequests: true,
      dupSameRequest: false,
    });
    expect(r.flag).toBe('red');
    expect(r.flagReason).toContain('其他充值');
  });

  it('yellow when duplicate in same request', () => {
    const r = computeWalletTopupScreenshotRiskFlags({
      md5Hex: 'abc',
      createdAtMillis: 1000,
      uploadMillis: 2000,
      dupOtherRequests: false,
      dupSameRequest: true,
    });
    expect(r.flag).toBe('yellow');
  });

  it('yellow when upload before request created', () => {
    const r = computeWalletTopupScreenshotRiskFlags({
      md5Hex: 'abc',
      createdAtMillis: 5000,
      uploadMillis: 1000,
      dupOtherRequests: false,
      dupSameRequest: false,
    });
    expect(r.flag).toBe('yellow');
    expect(r.flagReason).toContain('早于');
  });

  it('green when no md5 and time ok', () => {
    const r = computeWalletTopupScreenshotRiskFlags({
      md5Hex: '',
      createdAtMillis: 1000,
      uploadMillis: 2000,
      dupOtherRequests: false,
      dupSameRequest: false,
    });
    expect(r.flag).toBe('green');
  });
});
