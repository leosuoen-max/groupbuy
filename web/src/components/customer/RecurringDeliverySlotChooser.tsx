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

  const displayLabel = value
    ? formatDeliverySlotLabel(value.date, value.period)
    : '—';

  if (options.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-2.5">
      {!open ? (
        <button
          type="button"
          className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200/80 hover:bg-emerald-50"
          onClick={() => {
            setOpen(true);
            if (!value && options[0]) onChange(options[0]!);
          }}
        >
          更改配送时间
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-emerald-900">
            选择配送时间
            <select
              className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-2 py-2 text-sm text-gray-900"
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || !selectedKey}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-gray-300"
                onClick={onConfirm}
              >
                {saving ? '保存中…' : '确认更改'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs text-gray-700"
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
              className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
              onClick={() => setOpen(false)}
            >
              完成
            </button>
          )}
          {message ? <p className="text-xs text-gray-600">{message}</p> : null}
        </div>
      )}
      {!open && mode === 'checkout' ? (
        <p className="mt-2 text-center text-xs text-emerald-800/90">
          当前选择：{displayLabel}
        </p>
      ) : null}
    </div>
  );
}
