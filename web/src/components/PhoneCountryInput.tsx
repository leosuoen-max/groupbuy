import {
  DEFAULT_PHONE_COUNTRY_INPUT,
  PHONE_COUNTRIES,
  type PhoneCountryId,
  type PhoneCountryInputValue,
} from '../lib/phoneCountries';

type Props = {
  value?: PhoneCountryInputValue;
  onChange: (value: PhoneCountryInputValue) => void;
  disabled?: boolean;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
  dialInputClassName?: string;
};

const fieldBase =
  'h-11 rounded-xl border border-gray-200 bg-white text-[16px] outline-none focus:border-orange-300';

export function PhoneCountryInput({
  value = DEFAULT_PHONE_COUNTRY_INPUT,
  onChange,
  disabled = false,
  className = '',
  selectClassName = '',
  inputClassName = '',
  dialInputClassName = '',
}: Props) {
  const country =
    PHONE_COUNTRIES.find((c) => c.id === value.countryId) ?? PHONE_COUNTRIES[0]!;
  const isOther = value.countryId === 'OTHER';

  const patch = (partial: Partial<PhoneCountryInputValue>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div className={`flex items-stretch gap-2 ${className}`}>
      <select
        disabled={disabled}
        value={value.countryId}
        onChange={(e) => {
          const countryId = e.target.value as PhoneCountryId;
          patch({
            countryId,
            ...(countryId !== 'OTHER' ? { customDialCode: undefined } : {}),
          });
        }}
        aria-label="国家或地区"
        className={`w-[7.75rem] max-w-[42%] shrink-0 px-1.5 text-sm font-semibold tabular-nums ${fieldBase} ${selectClassName}`}
      >
        {PHONE_COUNTRIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id === 'OTHER' ? '其他…' : `+${c.dialCode} ${c.label}`}
          </option>
        ))}
      </select>
      {isOther ? (
        <label className="flex w-[5.5rem] shrink-0 items-center gap-0.5">
          <span className="text-sm font-medium text-gray-600">+</span>
          <input
            type="tel"
            inputMode="numeric"
            disabled={disabled}
            value={value.customDialCode ?? ''}
            onChange={(e) =>
              patch({
                customDialCode: e.target.value.replace(/[^\d]/g, '').slice(0, 4),
              })
            }
            placeholder="区号"
            aria-label="国家或地区码"
            className={`w-full px-1.5 text-center ${fieldBase} ${dialInputClassName}`}
          />
        </label>
      ) : null}
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        disabled={disabled}
        value={value.nationalNumber}
        onChange={(e) => patch({ nationalNumber: e.target.value })}
        placeholder={country.placeholder}
        aria-label="手机号码"
        title={country.label}
        className={`min-w-0 flex-1 px-3 ${fieldBase} ${inputClassName}`}
      />
    </div>
  );
}
