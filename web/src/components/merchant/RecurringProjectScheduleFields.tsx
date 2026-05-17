import { buildRecurringConsumerNoticeText } from '../../lib/recurringDeliverySchedule';
import {
  formatDateInputValue,
  type DeliverySlotPeriod,
} from '../../lib/deliverySlot';
import type { RecurringDeliveryScheduleDoc } from '../../types/firestore';

export type RecurringFormState = {
  salesStartDate: string;
  salesEndDate: string;
  firstDeliveryDate: string;
  firstDeliveryPeriod: DeliverySlotPeriod;
  lastDeliveryDate: string;
  lastDeliveryPeriod: DeliverySlotPeriod;
  frequency: 'once_daily' | 'twice_daily';
  onceDailyPeriod: DeliverySlotPeriod;
  middayCutoffTime: string;
  eveningCutoffTime: string;
};

export function defaultRecurringForm(): RecurringFormState {
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDateInputValue(d);
  })();
  const today = formatDateInputValue(new Date());
  return {
    salesStartDate: today,
    salesEndDate: tomorrow,
    firstDeliveryDate: tomorrow,
    firstDeliveryPeriod: 'midday',
    lastDeliveryDate: tomorrow,
    lastDeliveryPeriod: 'midday',
    frequency: 'once_daily',
    onceDailyPeriod: 'midday',
    middayCutoffTime: '10:00',
    eveningCutoffTime: '15:00',
  };
}

export function buildScheduleFromForm(
  form: RecurringFormState
): RecurringDeliveryScheduleDoc {
  const schedule: RecurringDeliveryScheduleDoc = {
    salesStartDate: form.salesStartDate.trim(),
    salesEndDate: form.salesEndDate.trim(),
    firstDeliveryDate: form.firstDeliveryDate.trim(),
    firstDeliveryPeriod: form.firstDeliveryPeriod,
    lastDeliveryDate: form.lastDeliveryDate.trim(),
    lastDeliveryPeriod: form.lastDeliveryPeriod,
    frequency: form.frequency,
    middayCutoffTime: form.middayCutoffTime.trim(),
    ...(form.frequency === 'once_daily'
      ? { onceDailyPeriod: form.onceDailyPeriod }
      : {}),
    ...(form.frequency === 'twice_daily' || form.onceDailyPeriod === 'evening'
      ? { eveningCutoffTime: form.eveningCutoffTime.trim() }
      : {}),
  };
  schedule.consumerNoticeText = buildRecurringConsumerNoticeText(schedule);
  return schedule;
}

export function recurringFormFromSchedule(
  s: RecurringDeliveryScheduleDoc
): RecurringFormState {
  return {
    salesStartDate: s.salesStartDate,
    salesEndDate: s.salesEndDate,
    firstDeliveryDate: s.firstDeliveryDate,
    firstDeliveryPeriod: s.firstDeliveryPeriod,
    lastDeliveryDate: s.lastDeliveryDate,
    lastDeliveryPeriod: s.lastDeliveryPeriod,
    frequency: s.frequency,
    onceDailyPeriod: s.onceDailyPeriod ?? 'midday',
    middayCutoffTime: s.middayCutoffTime,
    eveningCutoffTime: s.eveningCutoffTime ?? '15:00',
  };
}

type Props = {
  inputClass: string;
  form: RecurringFormState;
  onChange: (next: RecurringFormState) => void;
  closesAtLabel: string;
  validationError: string | null;
  consumerNotice: string | undefined;
};

export function RecurringProjectScheduleFields({
  inputClass,
  form,
  onChange,
  closesAtLabel,
  validationError,
  consumerNotice,
}: Props) {
  const patch = (p: Partial<RecurringFormState>) => onChange({ ...form, ...p });

  return (
    <fieldset className="block space-y-3 text-sm font-medium text-gray-800">
      <legend className="mb-2">长期配送计划（必填）</legend>
      <p className="text-xs font-normal text-gray-600">
        项目截止时间由<strong>最后一次配送的截单时刻</strong>自动计算；顾客付款时间决定配送档。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block font-normal">
          <span className="mb-1 block text-xs text-gray-600">销售开始日</span>
          <input
            type="date"
            className={inputClass}
            value={form.salesStartDate}
            onChange={(e) => patch({ salesStartDate: e.target.value })}
          />
        </label>
        <label className="block font-normal">
          <span className="mb-1 block text-xs text-gray-600">销售截止日</span>
          <input
            type="date"
            className={inputClass}
            value={form.salesEndDate}
            onChange={(e) => patch({ salesEndDate: e.target.value })}
          />
        </label>
        <label className="block font-normal">
          <span className="mb-1 block text-xs text-gray-600">第一次配送日</span>
          <input
            type="date"
            className={inputClass}
            value={form.firstDeliveryDate}
            onChange={(e) => patch({ firstDeliveryDate: e.target.value })}
          />
        </label>
        <label className="block font-normal">
          <span className="mb-1 block text-xs text-gray-600">第一次配送时段</span>
          <select
            className={inputClass}
            value={form.firstDeliveryPeriod}
            onChange={(e) =>
              patch({ firstDeliveryPeriod: e.target.value as DeliverySlotPeriod })
            }
          >
            <option value="midday">中午</option>
            <option value="evening">傍晚</option>
          </select>
        </label>
        <label className="block font-normal">
          <span className="mb-1 block text-xs text-gray-600">最后一次配送日</span>
          <input
            type="date"
            className={inputClass}
            value={form.lastDeliveryDate}
            onChange={(e) => patch({ lastDeliveryDate: e.target.value })}
          />
        </label>
        <label className="block font-normal">
          <span className="mb-1 block text-xs text-gray-600">最后一次配送时段</span>
          <select
            className={inputClass}
            value={form.lastDeliveryPeriod}
            onChange={(e) =>
              patch({ lastDeliveryPeriod: e.target.value as DeliverySlotPeriod })
            }
          >
            <option value="midday">中午</option>
            <option value="evening">傍晚</option>
          </select>
        </label>
      </div>
      <div className="font-normal">
        <p className="mb-2 text-xs text-gray-600">配送规律</p>
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="frequency"
              checked={form.frequency === 'once_daily'}
              onChange={() => patch({ frequency: 'once_daily' })}
            />
            每天 1 次
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="frequency"
              checked={form.frequency === 'twice_daily'}
              onChange={() => patch({ frequency: 'twice_daily' })}
            />
            每天 2 次
          </label>
        </div>
        {form.frequency === 'once_daily' ? (
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="onceDailyPeriod"
                checked={form.onceDailyPeriod === 'midday'}
                onChange={() => patch({ onceDailyPeriod: 'midday' })}
              />
              仅中午
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="onceDailyPeriod"
                checked={form.onceDailyPeriod === 'evening'}
                onChange={() => patch({ onceDailyPeriod: 'evening' })}
              />
              仅傍晚
            </label>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 font-normal">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">中午截单</span>
          <input
            type="time"
            className={inputClass}
            value={form.middayCutoffTime}
            onChange={(e) => patch({ middayCutoffTime: e.target.value })}
          />
        </label>
        {form.frequency === 'twice_daily' || form.onceDailyPeriod === 'evening' ? (
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">傍晚截单</span>
            <input
              type="time"
              className={inputClass}
              value={form.eveningCutoffTime}
              onChange={(e) => patch({ eveningCutoffTime: e.target.value })}
            />
          </label>
        ) : null}
      </div>
      <p className="text-xs font-normal text-gray-500">项目截止：{closesAtLabel}</p>
      {validationError ? (
        <p className="text-xs text-red-600">{validationError}</p>
      ) : consumerNotice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-normal text-emerald-900">
          顾客端说明：{consumerNotice}
        </p>
      ) : null}
    </fieldset>
  );
}
