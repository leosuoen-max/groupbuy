import type { ReactNode } from 'react';
import { FEITUAN_TW } from '../../lib/feituanHomeTheme';

type Props = {
  name: string;
  phone: string;
  address: string;
  note: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onAddressChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  /** 行内标签（直下确认页） */
  layout?: 'stack' | 'inline';
  addressRows?: number;
  children?: ReactNode;
};

export function FeituanContactFields({
  name,
  phone,
  address,
  note,
  onNameChange,
  onPhoneChange,
  onAddressChange,
  onNoteChange,
  layout = 'stack',
  addressRows = 2,
  children,
}: Props) {
  if (layout === 'inline') {
    const labelCls = 'w-12 shrink-0 text-sm text-[#0F8F5F]/80';
    return (
      <div className="space-y-2.5">
        <label className="flex items-center gap-2">
          <span className={labelCls}>姓名：</span>
          <input
            className={`min-w-0 flex-1 ${FEITUAN_TW.inputInline}`}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            autoComplete="name"
            placeholder="必填"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className={labelCls}>电话：</span>
          <input
            className={`min-w-0 flex-1 ${FEITUAN_TW.inputInline}`}
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="建议填写"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className={labelCls}>备注：</span>
          <input
            className={`min-w-0 flex-1 ${FEITUAN_TW.inputInline}`}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="选填"
          />
        </label>
        <label className="flex items-start gap-2">
          <span className={`${labelCls} pt-2`}>地址：</span>
          <textarea
            className={`min-w-0 flex-1 ${FEITUAN_TW.inputInline} resize-y`}
            style={{ minHeight: `${addressRows * 1.25 + 1.5}rem` }}
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            autoComplete="street-address"
            placeholder="小区、大厦、片区等"
          />
        </label>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <label className="block">
        <span className={FEITUAN_TW.fieldLabel}>姓名</span>
        <input
          className={FEITUAN_TW.input}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoComplete="name"
        />
      </label>
      <label className="block">
        <span className={FEITUAN_TW.fieldLabel}>电话</span>
        <input
          className={FEITUAN_TW.input}
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
        />
      </label>
      <label className="block">
        <span className={FEITUAN_TW.fieldLabel}>地址</span>
        <textarea
          className={`${FEITUAN_TW.input} resize-y`}
          rows={addressRows}
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          autoComplete="street-address"
        />
      </label>
      <label className="block">
        <span className={FEITUAN_TW.fieldLabel}>备注</span>
        <input
          className={FEITUAN_TW.input}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      </label>
      {children}
    </div>
  );
}
