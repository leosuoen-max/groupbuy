export type PhoneCountryId =
  | 'MY'
  | 'CN'
  | 'SG'
  | 'HK'
  | 'TW'
  | 'ID'
  | 'TH'
  | 'BN'
  | 'US'
  | 'OTHER';

export type PhoneCountryDef = {
  id: PhoneCountryId;
  label: string;
  dialCode: string;
  /** 号码框占位提示（不含国家码） */
  placeholder: string;
  /** 去掉非数字、可选去掉首位 0 后的位数范围 */
  nationalLength: { min: number; max: number };
  stripLeadingZero?: boolean;
};

export const DEFAULT_PHONE_COUNTRY_ID: PhoneCountryId = 'MY';

export const PHONE_COUNTRIES: PhoneCountryDef[] = [
  {
    id: 'MY',
    label: '马来西亚',
    dialCode: '60',
    placeholder: '12-345 6789',
    nationalLength: { min: 9, max: 11 },
    stripLeadingZero: true,
  },
  {
    id: 'CN',
    label: '中国',
    dialCode: '86',
    placeholder: '139 1234 5678',
    nationalLength: { min: 11, max: 11 },
  },
  {
    id: 'SG',
    label: '新加坡',
    dialCode: '65',
    placeholder: '8123 4567',
    nationalLength: { min: 8, max: 8 },
  },
  {
    id: 'HK',
    label: '中国香港',
    dialCode: '852',
    placeholder: '9123 4567',
    nationalLength: { min: 8, max: 8 },
  },
  {
    id: 'TW',
    label: '中国台湾',
    dialCode: '886',
    placeholder: '912 345 678',
    nationalLength: { min: 9, max: 9 },
  },
  {
    id: 'ID',
    label: '印度尼西亚',
    dialCode: '62',
    placeholder: '812 3456 7890',
    nationalLength: { min: 9, max: 12 },
    stripLeadingZero: true,
  },
  {
    id: 'TH',
    label: '泰国',
    dialCode: '66',
    placeholder: '81 234 5678',
    nationalLength: { min: 9, max: 9 },
    stripLeadingZero: true,
  },
  {
    id: 'BN',
    label: '文莱',
    dialCode: '673',
    placeholder: '712 3456',
    nationalLength: { min: 7, max: 7 },
  },
  {
    id: 'US',
    label: '美国',
    dialCode: '1',
    placeholder: '202 555 0100',
    nationalLength: { min: 10, max: 10 },
  },
  {
    id: 'OTHER',
    label: '其他',
    dialCode: '',
    placeholder: '本地号码',
    nationalLength: { min: 4, max: 14 },
  },
];

export function getPhoneCountryById(id: string): PhoneCountryDef | undefined {
  return PHONE_COUNTRIES.find((c) => c.id === id);
}

export type PhoneCountryInputValue = {
  countryId: PhoneCountryId;
  nationalNumber: string;
  /** 仅 countryId === 'OTHER' 时使用，不含 + */
  customDialCode?: string;
};

export const DEFAULT_PHONE_COUNTRY_INPUT: PhoneCountryInputValue = {
  countryId: DEFAULT_PHONE_COUNTRY_ID,
  nationalNumber: '',
};
