import {
  getPhoneCountryById,
  type PhoneCountryDef,
  type PhoneCountryInputValue,
} from './phoneCountries';

/** 将用户输入规范为 E.164（仅保留 + 与数字）；兼容旧版整段粘贴 */
export function normalizePhoneE164(raw: string): string {
  const v = raw.replace(/\s+/g, '');
  if (v.startsWith('+')) {
    return `+${v.slice(1).replace(/[^\d]/g, '')}`;
  }
  const digits = v.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('86')) return `+${digits}`;
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+86${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return `+60${digits}`;
}

function normalizeNationalDigits(
  country: PhoneCountryDef,
  nationalRaw: string
): string {
  let digits = nationalRaw.replace(/\D/g, '');
  if (country.stripLeadingZero && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

export function resolveDialCodeForInput(value: PhoneCountryInputValue): string {
  if (value.countryId === 'OTHER') {
    return (value.customDialCode ?? '').replace(/\D/g, '');
  }
  return getPhoneCountryById(value.countryId)?.dialCode ?? '60';
}

/** 国家选择 + 本地号码 → E.164 */
export function phoneCountryValueToE164(value: PhoneCountryInputValue): string {
  const country = getPhoneCountryById(value.countryId);
  if (!country) return '';
  const national = normalizeNationalDigits(country, value.nationalNumber);
  if (!national) return '';
  const dial = resolveDialCodeForInput(value);
  if (!dial) return '';
  return `+${dial}${national}`;
}

function validateNationalForCountry(
  country: PhoneCountryDef,
  nationalDigits: string
): string | null {
  const { min, max } = country.nationalLength;
  if (nationalDigits.length < min) {
    return `${country.label}手机号位数不足（需 ${min}${min === max ? '' : `–${max}`} 位，不含国家码）。`;
  }
  if (nationalDigits.length > max) {
    return `${country.label}手机号位数过多，请检查。`;
  }
  if (country.id === 'CN' && !nationalDigits.startsWith('1')) {
    return '中国大陆手机号通常以 1 开头。';
  }
  return null;
}

/** 发送验证码前的本地校验；通过返回 null */
export function validatePhoneCountryParts(value: PhoneCountryInputValue): string | null {
  const country = getPhoneCountryById(value.countryId);
  if (!country) return '请选择国家/地区';

  if (value.countryId === 'OTHER') {
    const dial = (value.customDialCode ?? '').replace(/\D/g, '');
    if (!dial || dial.length < 1 || dial.length > 4) {
      return '请在左侧填写 1–4 位国家/地区码（不含 +）。';
    }
  }

  const national = normalizeNationalDigits(country, value.nationalNumber);
  if (!national) return '请输入手机号';

  const nationalErr = validateNationalForCountry(country, national);
  if (nationalErr) return nationalErr;

  return validatePhoneE164(phoneCountryValueToE164(value));
}

/** @deprecated 优先使用 validatePhoneCountryParts */
export function validatePhoneE164(e164: string): string | null {
  if (!e164.startsWith('+')) {
    return '请输入手机号';
  }
  const body = e164.slice(1);
  if (!body) return '请输入手机号';

  if (body.startsWith('86')) {
    if (body.length !== 13) {
      return body.length < 13
        ? '中国大陆手机号为 11 位（不含 +86），你当前少了一位。'
        : '中国大陆手机号位数过多。';
    }
    if (!body.startsWith('861')) {
      return '中国大陆手机号通常以 1 开头。';
    }
    return null;
  }

  if (body.startsWith('60')) {
    if (body.length < 11 || body.length > 13) {
      return '马来西亚手机号格式不正确（一般为 +60 加 9–11 位本地号）。';
    }
    return null;
  }

  if (body.startsWith('65') && body.length !== 10) {
    return '新加坡手机号为 8 位（不含 +65）。';
  }

  if (body.length < 8 || body.length > 15) {
    return '手机号位数不正确，请检查国家/地区与号码。';
  }
  return null;
}

export function formatFirebasePhoneAuthError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/TOO_SHORT|invalid-phone-number/i.test(msg)) {
    return '手机号格式不正确：请确认左侧国家/地区码与右侧本地号码位数。';
  }
  if (/TOO_LONG/i.test(msg)) {
    return '手机号位数过多，请检查国家码与号码。';
  }
  if (/invalid-verification-code/i.test(msg)) {
    return '验证码不正确或已过期，请重新获取后再试。';
  }
  if (/code-expired/i.test(msg)) {
    return '验证码已过期，请重新发送。';
  }
  if (/too-many-requests|quota-exceeded/i.test(msg)) {
    return '请求过于频繁，请稍后再试。';
  }
  return msg || '验证失败，请重试';
}
