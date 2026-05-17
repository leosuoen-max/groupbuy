import type { Timestamp } from 'firebase/firestore';
import type { OrderDoc, ProjectDoc } from '../types/firestore';

/** 配送时段：中午 / 傍晚（展示文案，非餐饮专用「午餐/晚餐」） */
export type DeliverySlotPeriod = 'midday' | 'evening';

export type ProjectDeliverySlot = {
  date: string;
  period: DeliverySlotPeriod;
};

export type OrderDeliverySlotSnapshot = {
  date: string;
  period: DeliverySlotPeriod;
  /** 下单时固化，例如「5/18（周日）中午」 */
  label: string;
};

export const WEEKDAY_ZH = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDeliveryDateLocal(dateStr: string): Date | null {
  const m = DATE_RE.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) {
    return null;
  }
  return dt;
}

export function formatDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 默认配送日：明天（本地日历） */
export function defaultDeliveryDateInput(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDateInputValue(d);
}

export function deliveryPeriodLabel(period: DeliverySlotPeriod): string {
  return period === 'midday' ? '中午' : '傍晚';
}

/** 统一展示：5/18（周日）中午 */
export function formatDeliverySlotLabel(
  dateStr: string,
  period: DeliverySlotPeriod
): string {
  const dt = parseDeliveryDateLocal(dateStr);
  if (!dt) return '';
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const weekday = WEEKDAY_ZH[dt.getDay()];
  return `${m}/${day}（${weekday}）${deliveryPeriodLabel(period)}`;
}

export function buildOrderDeliverySlotSnapshot(
  slot: ProjectDeliverySlot
): OrderDeliverySlotSnapshot {
  return {
    date: slot.date,
    period: slot.period,
    label: formatDeliverySlotLabel(slot.date, slot.period),
  };
}

export function buildProjectDeliveryFields(
  date: string,
  period: DeliverySlotPeriod
): Pick<ProjectDoc, 'deliveryDate' | 'deliveryPeriod' | 'deliveryTimeText'> {
  return {
    deliveryDate: date,
    deliveryPeriod: period,
    deliveryTimeText: formatDeliverySlotLabel(date, period),
  };
}

export function hasProjectDeliverySlotConfigured(
  project: Pick<ProjectDoc, 'deliveryDate' | 'deliveryPeriod'>
): boolean {
  if (!project.deliveryDate?.trim() || !project.deliveryPeriod) return false;
  return parseDeliveryDateLocal(project.deliveryDate) != null;
}

export function inferDeliveryPeriodFromText(text: string): DeliverySlotPeriod | null {
  const t = text.trim();
  if (!t) return null;
  if (/傍晚|晚饭|晚餐时|晚餐(?![间时])/.test(t)) return 'evening';
  if (/中午|午间|午餐时/.test(t)) return 'midday';
  if (/晚餐|晚饭/.test(t)) return 'evening';
  if (/午餐/.test(t)) return 'midday';
  return null;
}

function inferDeliveryDateFromText(
  text: string,
  fallback?: Date | null
): string | null {
  const t = text.trim();
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (parseDeliveryDateLocal(candidate)) return candidate;
  }
  const slash = t.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const ref = fallback ?? new Date();
    const y = ref.getFullYear();
    const candidate = formatDateInputValue(
      new Date(y, Number(slash[1]) - 1, Number(slash[2]), 12, 0, 0, 0)
    );
    if (parseDeliveryDateLocal(candidate)) return candidate;
  }
  const cn = t.match(/(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const ref = fallback ?? new Date();
    const y = ref.getFullYear();
    const candidate = formatDateInputValue(
      new Date(y, Number(cn[1]) - 1, Number(cn[2]), 12, 0, 0, 0)
    );
    if (parseDeliveryDateLocal(candidate)) return candidate;
  }
  if (fallback) return formatDateInputValue(fallback);
  return null;
}

/** 从旧 deliveryTimeText 或 closesAt 推断（迁移/编辑页回填） */
export function inferDeliverySlotFromLegacy(
  deliveryTimeText?: string | null,
  closesAt?: Date | null
): ProjectDeliverySlot | null {
  const text = deliveryTimeText?.trim() ?? '';
  const period = inferDeliveryPeriodFromText(text) ?? 'midday';
  const date =
    inferDeliveryDateFromText(text, closesAt ?? null) ??
    (closesAt ? formatDateInputValue(closesAt) : null);
  if (!date || !parseDeliveryDateLocal(date)) return null;
  return { date, period };
}

export function resolveProjectDeliverySlot(
  project: Pick<ProjectDoc, 'deliveryDate' | 'deliveryPeriod' | 'deliveryTimeText'> & {
    closesAt?: ProjectDoc['closesAt'];
  }
): ProjectDeliverySlot | null {
  if (
    hasProjectDeliverySlotConfigured(project) &&
    project.deliveryPeriod
  ) {
    return {
      date: project.deliveryDate!.trim(),
      period: project.deliveryPeriod,
    };
  }
  return inferDeliverySlotFromLegacy(
    project.deliveryTimeText,
    project.closesAt?.toDate?.() ?? null
  );
}

export function resolveProjectDeliveryLabel(
  project: Pick<ProjectDoc, 'deliveryDate' | 'deliveryPeriod' | 'deliveryTimeText'> & {
    closesAt?: ProjectDoc['closesAt'];
  }
): string {
  const slot = resolveProjectDeliverySlot(project);
  if (slot) return formatDeliverySlotLabel(slot.date, slot.period);
  return project.deliveryTimeText?.trim() ?? '';
}

/** 历史订单无快照时显示「—」（方案 A，不回退读项目） */
export function formatOrderDeliverySlotLabel(
  order: Pick<OrderDoc, 'deliverySlot'>
): string {
  const s = order.deliverySlot;
  if (!s) return '—';
  if (s.label?.trim()) return s.label.trim();
  if (s.date && s.period) return formatDeliverySlotLabel(s.date, s.period);
  return '—';
}

export function closesAtToDate(closesAt: Timestamp | undefined): Date | null {
  if (!closesAt?.toDate) return null;
  try {
    return closesAt.toDate();
  } catch {
    return null;
  }
}
