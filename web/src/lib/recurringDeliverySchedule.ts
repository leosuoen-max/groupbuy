import type { ProjectDoc, RecurringDeliveryScheduleDoc } from '../types/firestore';
import {
  formatDeliverySlotLabel,
  formatDateInputValue,
  parseDeliveryDateLocal,
  type ProjectDeliverySlot,
} from './deliverySlot';

export type PaymentWindow = {
  startMs: number;
  endMs: number;
  slot: ProjectDeliverySlot;
};

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function parseCutoffTimeLocal(dateStr: string, hhmm: string): Date | null {
  const day = parseDeliveryDateLocal(dateStr);
  if (!day) return null;
  const m = TIME_RE.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min, 0, 0);
}

function addCalendarDays(dateStr: string, delta: number): string {
  const d = parseDeliveryDateLocal(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + delta);
  return formatDateInputValue(d);
}

function compareSlots(a: ProjectDeliverySlot, b: ProjectDeliverySlot): number {
  const da = parseDeliveryDateLocal(a.date)?.getTime() ?? 0;
  const db = parseDeliveryDateLocal(b.date)?.getTime() ?? 0;
  if (da !== db) return da - db;
  if (a.period === b.period) return 0;
  return a.period === 'midday' ? -1 : 1;
}

export function enumerateDeliverySlots(
  schedule: RecurringDeliveryScheduleDoc
): ProjectDeliverySlot[] {
  const first: ProjectDeliverySlot = {
    date: schedule.firstDeliveryDate,
    period: schedule.firstDeliveryPeriod,
  };
  const last: ProjectDeliverySlot = {
    date: schedule.lastDeliveryDate,
    period: schedule.lastDeliveryPeriod,
  };
  const slots: ProjectDeliverySlot[] = [];
  let cur = first;
  for (let guard = 0; guard < 5000; guard++) {
    slots.push({ ...cur });
    if (compareSlots(cur, last) >= 0) break;
    cur = nextSlotInSequence(cur, schedule);
  }
  return slots;
}

function nextSlotInSequence(
  slot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc
): ProjectDeliverySlot {
  if (schedule.frequency === 'twice_daily') {
    if (slot.period === 'midday') {
      return { date: slot.date, period: 'evening' };
    }
    return { date: addCalendarDays(slot.date, 1), period: 'midday' };
  }
  const period =
    schedule.onceDailyPeriod === 'evening' ? 'evening' : 'midday';
  return { date: addCalendarDays(slot.date, 1), period };
}

function cutoffTimeForSlot(
  slot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc
): string {
  if (slot.period === 'midday') return schedule.middayCutoffTime;
  return schedule.eveningCutoffTime ?? schedule.middayCutoffTime;
}

export function getCutoffInstantForSlot(
  slot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc
): Date | null {
  return parseCutoffTimeLocal(slot.date, cutoffTimeForSlot(slot, schedule));
}

function windowStartForSlot(
  slot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc,
  prevSlot: ProjectDeliverySlot | null
): Date | null {
  if (prevSlot) {
    return getCutoffInstantForSlot(prevSlot, schedule);
  }
  const prevDay = addCalendarDays(slot.date, -1);
  if (schedule.frequency === 'twice_daily') {
    const t2 = schedule.eveningCutoffTime ?? schedule.middayCutoffTime;
    return parseCutoffTimeLocal(prevDay, t2);
  }
  const t =
    schedule.onceDailyPeriod === 'evening'
      ? schedule.eveningCutoffTime ?? schedule.middayCutoffTime
      : schedule.middayCutoffTime;
  return parseCutoffTimeLocal(prevDay, t);
}

export function buildPaymentWindows(
  schedule: RecurringDeliveryScheduleDoc
): PaymentWindow[] {
  const slots = enumerateDeliverySlots(schedule);
  const windows: PaymentWindow[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const prev = i > 0 ? slots[i - 1]! : null;
    const start = windowStartForSlot(slot, schedule, prev);
    const end = getCutoffInstantForSlot(slot, schedule);
    if (!start || !end) continue;
    windows.push({
      startMs: start.getTime(),
      endMs: end.getTime(),
      slot,
    });
  }
  return windows;
}

export function resolveSlotFromPaymentTime(
  paymentAt: Date,
  schedule: RecurringDeliveryScheduleDoc
): ProjectDeliverySlot | null {
  const slots = enumerateDeliverySlots(schedule);
  if (!slots.length) return null;
  const closes = computeClosesAtDate(schedule);
  if (!closes) return null;
  if (paymentAt.getTime() >= closes.getTime()) return null;

  const windows = buildPaymentWindows(schedule);
  if (!windows.length) return slots[0]!;

  if (paymentAt.getTime() < windows[0]!.startMs) {
    return slots[0]!;
  }

  for (const w of windows) {
    if (paymentAt.getTime() >= w.startMs && paymentAt.getTime() < w.endMs) {
      return w.slot;
    }
  }
  return slots[slots.length - 1]!;
}

export function computeClosesAtDate(
  schedule: RecurringDeliveryScheduleDoc
): Date | null {
  const last: ProjectDeliverySlot = {
    date: schedule.lastDeliveryDate,
    period: schedule.lastDeliveryPeriod,
  };
  return getCutoffInstantForSlot(last, schedule);
}

export function formatSalesDateLabel(dateStr: string): string {
  const d = parseDeliveryDateLocal(dateStr);
  if (!d) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function buildRecurringConsumerNoticeText(
  schedule: RecurringDeliveryScheduleDoc
): string {
  const sales = `${formatSalesDateLabel(schedule.salesStartDate)} – ${formatSalesDateLabel(schedule.salesEndDate)}`;
  let delivery: string;
  let cutoff: string;

  if (schedule.frequency === 'twice_daily') {
    delivery = '每天配送 2 次（中午、傍晚）';
    cutoff = `中午档 ${schedule.middayCutoffTime} 前付款归当日中午；傍晚档 ${schedule.eveningCutoffTime ?? '—'} 前付款归当日傍晚；傍晚截单后付款归下一配送日第一档`;
  } else if (schedule.onceDailyPeriod === 'evening') {
    delivery = '每天配送 1 次（傍晚）';
    const t = schedule.eveningCutoffTime ?? schedule.middayCutoffTime;
    cutoff = `每日 ${t} 前付款归当日傍晚；截单后付款归下一配送日傍晚`;
  } else {
    delivery = '每天配送 1 次（中午）';
    cutoff = `每日 ${schedule.middayCutoffTime} 前付款归当日中午；截单后付款归下一配送日中午`;
  }

  return `销售日期：${sales}；配送：${delivery}；配送截单：${cutoff}`;
}

export function listSlotsAfter(
  current: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc
): ProjectDeliverySlot[] {
  const all = enumerateDeliverySlots(schedule);
  return all.filter((s) => compareSlots(s, current) > 0);
}

export function isProjectRecurring(
  project: Pick<ProjectDoc, 'projectKind'>
): boolean {
  return project.projectKind === 'recurring';
}

export function getRecurringSchedule(
  project: Pick<ProjectDoc, 'projectKind' | 'recurringSchedule'>
): RecurringDeliveryScheduleDoc | null {
  if (!isProjectRecurring(project)) return null;
  return project.recurringSchedule ?? null;
}

export function validateRecurringSchedule(
  schedule: RecurringDeliveryScheduleDoc
): string | null {
  if (!parseDeliveryDateLocal(schedule.salesStartDate)) {
    return '请填写销售开始日期';
  }
  if (!parseDeliveryDateLocal(schedule.salesEndDate)) {
    return '请填写销售截止日期';
  }
  if (!parseDeliveryDateLocal(schedule.firstDeliveryDate)) {
    return '请填写第一次配送日期';
  }
  if (!parseDeliveryDateLocal(schedule.lastDeliveryDate)) {
    return '请填写最后一次配送日期';
  }
  if (!TIME_RE.test(schedule.middayCutoffTime.trim())) {
    return '请填写中午截单时间（HH:mm）';
  }
  if (schedule.frequency === 'twice_daily') {
    if (!schedule.eveningCutoffTime?.trim() || !TIME_RE.test(schedule.eveningCutoffTime.trim())) {
      return '每日 2 次配送须填写傍晚截单时间';
    }
  } else if (schedule.onceDailyPeriod === 'evening') {
    if (!schedule.eveningCutoffTime?.trim() || !TIME_RE.test(schedule.eveningCutoffTime.trim())) {
      return '每日傍晚配送须填写截单时间';
    }
  }
  const first: ProjectDeliverySlot = {
    date: schedule.firstDeliveryDate,
    period: schedule.firstDeliveryPeriod,
  };
  const last: ProjectDeliverySlot = {
    date: schedule.lastDeliveryDate,
    period: schedule.lastDeliveryPeriod,
  };
  if (compareSlots(first, last) > 0) {
    return '最后一次配送须不早于第一次配送';
  }
  const slots = enumerateDeliverySlots(schedule);
  if (!slots.length) return '配送期配置无效';
  if (compareSlots(slots[0]!, first) !== 0) {
    return '第一次配送与配送序列起点不一致';
  }
  const tail = slots[slots.length - 1]!;
  if (compareSlots(tail, last) !== 0) {
    return '最后一次配送与配送序列终点不一致';
  }
  return null;
}

export function estimateSlotIfPaidNow(
  project: Pick<ProjectDoc, 'projectKind' | 'recurringSchedule'>
): ProjectDeliverySlot | null {
  const schedule = getRecurringSchedule(project);
  if (!schedule) return null;
  return resolveSlotFromPaymentTime(new Date(), schedule);
}

export function formatEstimatedDeliveryHint(
  project: Pick<ProjectDoc, 'projectKind' | 'recurringSchedule'>
): string {
  const slot = estimateSlotIfPaidNow(project);
  if (!slot) return '按付款时间分派配送时间';
  return `${formatDeliverySlotLabel(slot.date, slot.period)}（按付款时间分派）`;
}

export function getOrderSlotCutoffInstant(
  orderSlot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc
): Date | null {
  return getCutoffInstantForSlot(orderSlot, schedule);
}

export function canAppendBeforeSlotCutoff(
  orderSlot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc,
  now: Date = new Date()
): boolean {
  const cutoff = getOrderSlotCutoffInstant(orderSlot, schedule);
  if (!cutoff) return false;
  return now.getTime() < cutoff.getTime();
}

export function canChangeDeliverySlot(
  orderSlot: ProjectDeliverySlot,
  schedule: RecurringDeliveryScheduleDoc,
  now: Date = new Date()
): boolean {
  return canAppendBeforeSlotCutoff(orderSlot, schedule, now);
}
