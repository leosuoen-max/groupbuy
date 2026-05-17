import { describe, expect, it } from 'vitest';
import { DEFAULT_PHONE_COUNTRY_INPUT } from './phoneCountries';
import {
  normalizePhoneE164,
  phoneCountryValueToE164,
  validatePhoneCountryParts,
  validatePhoneE164,
} from './phoneE164';

describe('phoneCountryValueToE164', () => {
  it('defaults Malaysia +60 with leading zero stripped', () => {
    expect(
      phoneCountryValueToE164({
        countryId: 'MY',
        nationalNumber: '0123456789',
      })
    ).toBe('+60123456789');
  });

  it('builds China +86', () => {
    expect(
      phoneCountryValueToE164({
        countryId: 'CN',
        nationalNumber: '13912345678',
      })
    ).toBe('+8613912345678');
  });

  it('builds OTHER with custom dial code', () => {
    expect(
      phoneCountryValueToE164({
        countryId: 'OTHER',
        customDialCode: '44',
        nationalNumber: '7911123456',
      })
    ).toBe('+447911123456');
  });
});

describe('validatePhoneCountryParts', () => {
  it('rejects China number with too few digits', () => {
    expect(
      validatePhoneCountryParts({
        countryId: 'CN',
        nationalNumber: '1306556600',
      })
    ).toMatch(/位数不足/);
  });

  it('accepts valid China number', () => {
    expect(
      validatePhoneCountryParts({
        countryId: 'CN',
        nationalNumber: '13065566001',
      })
    ).toBeNull();
  });

  it('accepts default empty as error', () => {
    expect(validatePhoneCountryParts(DEFAULT_PHONE_COUNTRY_INPUT)).toMatch(/请输入/);
  });
});

describe('normalizePhoneE164 (legacy paste)', () => {
  it('still parses full +86 string', () => {
    expect(normalizePhoneE164('+8613912345678')).toBe('+8613912345678');
  });
});

describe('validatePhoneE164', () => {
  it('rejects +86 with 10 digits after country code', () => {
    expect(validatePhoneE164('+861306556600')).toMatch(/少了一位/);
  });
});
