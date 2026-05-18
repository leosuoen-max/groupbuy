import { useMemo, useState } from 'react';
import {
  formatDeliverySlotLabel,
  type ProjectDeliverySlot,
} from '../../lib/deliverySlot';
import { listRecurringCheckoutDeliveryOptions } from '../../lib/recurringDeliverySchedule';
import type { ProjectDoc } from '../../types/firestore';

function slotKey(slot: ProjectDeliverySlot): string {
  return `${slot.date}|${slot.period}`;
}

type Props = {
  project: ProjectDoc;
  value: ProjectDeliverySlot | null;
  onChange: (slot: ProjectDeliverySlot) => void;
  /** checkout：预选；detail：已付款后改档 */
  mode: 'checkout' | 'detail';
  options?: ProjectDeliverySlot[];
  saving?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  message?: string | null;
};

export function RecurringDeliverySlotChooser({
  project,
  value,
  onChange,
  mode,
  options: optionsProp,
  saving = false,
  onConfirm,
  onCancel,
  message,
}: Props) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => optionsProp ?? listRecurringCheckoutDeliveryOptions(project),
    [optionsProp, project]
  );

  const selectedKey = value ? slotKey(value) : '';

  if (options.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex shrink-0 items-center rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-xs font-medium leading-tight text-emerald-800 hover:bg-emerald-50"
        onClick={() => {
          setOpen(true);
          if (!value && options[0]) onChange(options[0]!);
        }}
      >
        更改配送时间
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1.5">
      <label className="block text-xs text-gray-600">
        选择配送时间
        <select
          className="mt-0.5 block max-w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900"
          value={selectedKey}
          onChange={(e) => {
            const [date, period] = e.target.value.split('|');
            if (!date || (period !== 'midday' && period !== 'evening')) return;
            onChange({ date, period });
          }}
        >
          {options.map((s) => {
            const key = slotKey(s);
            return (
              <option key={key} value={key}>
                {formatDeliverySlotLabel(s.date, s.period)}
              </option>
            );
          })}
        </select>
      </label>
      {mode === 'detail' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={saving || !selectedKey}
            className="rounded border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white disabled:border-gray-300 disabled:bg-gray-300"
            onClick={onConfirm}
          >
            {saving ? '保存中…' : '确认'}
          </button>
          <button
            type="button"
            className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"
            onClick={() => {
              setOpen(false);
              onCancel?.();
            }}
          >
            取消
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"
          onClick={() => setOpen(false)}
        >
          完成
        </button>
      )}
      {message ? <p className="text-xs text-gray-600">{message}</p> : null}
    </div>
  );
}
