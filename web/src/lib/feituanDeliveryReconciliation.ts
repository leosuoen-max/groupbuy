import type { DeliverySlotPeriod } from './deliverySlot';
import {
  linesInSelectedBuckets,
  listOrderPaymentGroups,
  orderMatchesBucketSelection,
  scopedGroupAmount,
  type BucketSelection,
} from './reconciliationGroups';
import { compareDeliverySlots } from './recurringDeliverySchedule';
import type { OrderDoc } from '../types/firestore';
import type { MockDeliveryPoint } from '../types/orderDraft';
import type { OrderRow } from './orderService';

export const UNKNOWN_DELIVERY_ZONE_KEY = '__unknown__';
export const OTHER_DELIVERY_ZONE_KEY = '__other__';

export type DeliveryPointGroup = {
  zoneKey: string;
  zoneName: string;
  pointKey: string;
  code: string;
  name: string;
  line1: string;
  line2: string;
  sortKey: string;
};

export type DeliveryManifestPoint = {
  pointKey: string;
  code: string;
  name: string;
  orderCount: number;
};

export type DeliveryManifestZone = {
  zoneKey: string;
  zoneName: string;
  orderCount: number;
  points: DeliveryManifestPoint[];
};

export function formatDeliverySlotParamKey(
  date: string,
  period: DeliverySlotPeriod
): string {
  return `${date}:${period}`;
}

export function parseDeliverySlotParamKey(
  key: string
): { date: string; period: DeliverySlotPeriod } | null {
  const trimmed = key.trim();
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) return null;
  const date = trimmed.slice(0, idx);
  const period = trimmed.slice(idx + 1);
  if (period !== 'midday' && period !== 'evening') return null;
  return { date, period };
}

export function orderMatchesDeliverySlotKey(
  order: Pick<OrderDoc, 'deliverySlot'>,
  slotKey: string
): boolean {
  const slot = parseDeliverySlotParamKey(slotKey);
  if (!slot) return false;
  const o = order.deliverySlot;
  return o?.date === slot.date && o?.period === slot.period;
}

export function listDeliverySlotOptionsFromOrders(
  rows: OrderRow[]
): Array<{ key: string; label: string }> {
  const m = new Map<string, string>();
  for (const row of rows) {
    const s = row.data.deliverySlot;
    if (!s?.date || !s?.period) continue;
    const key = formatDeliverySlotParamKey(s.date, s.period);
    const label =
      s.label?.trim() || `${s.date} ${s.period === 'midday' ? '中午' : '傍晚'}`;
    m.set(key, label);
  }
  return [...m.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => {
      const pa = parseDeliverySlotParamKey(a.key);
      const pb = parseDeliverySlotParamKey(b.key);
      if (!pa || !pb) return a.label.localeCompare(b.label, 'zh-CN');
      return compareDeliverySlots(pa, pb);
    });
}

export function buildFeituanDeliveryPointMap(
  points: MockDeliveryPoint[]
): Map<string, MockDeliveryPoint> {
  const m = new Map<string, MockDeliveryPoint>();
  for (const p of points) m.set(p.id, p);
  return m;
}

export function resolveDeliveryPointGroup(
  order: OrderDoc,
  pointById: Map<string, MockDeliveryPoint>
): DeliveryPointGroup {
  if (order.isManualMatch || !order.deliveryPointId?.trim()) {
    const name = order.deliveryPointSnapshot?.name?.trim() || '未指定配送点';
    const zoneName = '其他地址';
    return {
      zoneKey: OTHER_DELIVERY_ZONE_KEY,
      zoneName,
      pointKey: `other:${order.orderNumber}`,
      code: '',
      name,
      line1: zoneName,
      line2: name,
      sortKey: `zz-other\x00${name}`,
    };
  }

  const id = order.deliveryPointId.trim();
  const point = pointById.get(id);
  if (!point) {
    const name = order.deliveryPointSnapshot?.name?.trim() || '—';
    const zoneName = '未知配送点';
    return {
      zoneKey: UNKNOWN_DELIVERY_ZONE_KEY,
      zoneName,
      pointKey: `unknown:${id}`,
      code: '',
      name,
      line1: zoneName,
      line2: name,
      sortKey: `zz-unknown\x00${name}`,
    };
  }

  const zoneName = point.zoneName?.trim() || '未知配送点';
  const zoneKey = point.zoneId?.trim() || UNKNOWN_DELIVERY_ZONE_KEY;
  const code = point.code?.trim() ?? '';
  const name = point.name?.trim() || '—';
  const line1 = code ? `${zoneName} ${code}` : zoneName;
  return {
    zoneKey,
    zoneName,
    pointKey: id,
    code,
    name,
    line1,
    line2: name,
    sortKey: `${zoneName}\x00${code}\x00${name}`,
  };
}

function zoneSortRank(zoneName: string): number {
  if (zoneName === '其他地址') return 2;
  if (zoneName === '未知配送点') return 3;
  return 1;
}

export function buildDeliveryManifest(
  rows: OrderRow[],
  bucketSelection: BucketSelection,
  pointById: Map<string, MockDeliveryPoint>
): DeliveryManifestZone[] {
  const zoneMap = new Map<
    string,
    {
      zoneName: string;
      orderCount: number;
      points: Map<string, DeliveryManifestPoint>;
    }
  >();

  for (const row of rows) {
    const o = row.data;
    if (o.status === 'cancelled') continue;
    const groups = listOrderPaymentGroups(o);
    if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;

    const g = resolveDeliveryPointGroup(o, pointById);
    let zone = zoneMap.get(g.zoneKey);
    if (!zone) {
      zone = { zoneName: g.zoneName, orderCount: 0, points: new Map() };
      zoneMap.set(g.zoneKey, zone);
    }
    zone.orderCount += 1;

    let point = zone.points.get(g.pointKey);
    if (!point) {
      point = {
        pointKey: g.pointKey,
        code: g.code,
        name: g.name,
        orderCount: 0,
      };
      zone.points.set(g.pointKey, point);
    }
    point.orderCount += 1;
  }

  return [...zoneMap.entries()]
    .map(([zoneKey, zone]) => ({
      zoneKey,
      zoneName: zone.zoneName,
      orderCount: zone.orderCount,
      points: [...zone.points.values()].sort((a, b) => {
        const ca = a.code || a.name;
        const cb = b.code || b.name;
        return ca.localeCompare(cb, 'zh-CN');
      }),
    }))
    .filter((z) => z.orderCount > 0)
    .sort((a, b) => {
      const ra = zoneSortRank(a.zoneName);
      const rb = zoneSortRank(b.zoneName);
      if (ra !== rb) return ra - rb;
      return a.zoneName.localeCompare(b.zoneName, 'zh-CN');
    });
}

function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function buildDeliveryManifestCopyText(input: {
  slotLabel: string;
  projectLabel: string;
  zones: DeliveryManifestZone[];
}): string {
  const lines: string[] = [
    `配送清单 · ${input.slotLabel} · ${input.projectLabel}`,
    '',
  ];
  if (input.zones.length === 0) {
    lines.push('（暂无订单）');
    return lines.join('\n');
  }
  for (const z of input.zones) {
    lines.push(`${z.zoneName}：${z.orderCount} 单`);
    for (const p of z.points) {
      const codePart = p.code ? `${p.code} ` : '';
      lines.push(`  ${codePart}${p.name}：${p.orderCount} 单`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function buildDeliveryManifestCsv(zones: DeliveryManifestZone[]): string {
  const lines = ['配送区,配送点编号,配送点名称,单数'];
  for (const z of zones) {
    for (const p of z.points) {
      lines.push(
        [
          escCsv(z.zoneName),
          escCsv(p.code),
          escCsv(p.name),
          String(p.orderCount),
        ].join(',')
      );
    }
  }
  return lines.join('\n');
}

function formatLinesDetail(lines: { name: string; quantity: number }[]): string {
  if (lines.length === 0) return '—';
  return lines.map((l) => `${l.name}×${l.quantity}`).join('、');
}

function proofExportLabel(o: OrderDoc): string {
  const proofs = o.paymentScreenshots;
  if (!Array.isArray(proofs) || proofs.length === 0) return '无';
  return '有';
}

export function buildDeliveryDetailCsv(
  rows: OrderRow[],
  bucketSelection: BucketSelection,
  pointById: Map<string, MockDeliveryPoint>
): string {
  const header = [
    '配送点',
    '时间',
    '顾客',
    '电话',
    '订单号',
    '项目',
    '商品明细',
    '清单金额',
    '订单状态',
    '凭证',
  ];
  const outLines = [header.join(',')];
  const sorted = [...rows].sort((a, b) => {
    const da = resolveDeliveryPointGroup(a.data, pointById).sortKey;
    const db = resolveDeliveryPointGroup(b.data, pointById).sortKey;
    if (da !== db) return da.localeCompare(db, 'zh-CN');
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return ta - tb;
  });
  for (const r of sorted) {
    const o = r.data;
    if (o.status === 'cancelled') continue;
    const groups = listOrderPaymentGroups(o);
    if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;
    const g = resolveDeliveryPointGroup(o, pointById);
    const dpCell = g.line2 ? `${g.line1} / ${g.line2}` : g.line1;
    const scopedAmt = scopedGroupAmount(groups, bucketSelection);
    const detailLines = linesInSelectedBuckets(groups, bucketSelection);
    const created = o.createdAt?.toDate?.();
    const timeStr = created
      ? `${created.getMonth() + 1}-${created.getDate()} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`
      : '—';
    outLines.push(
      [
        escCsv(dpCell),
        escCsv(timeStr),
        escCsv(o.customerName ?? ''),
        escCsv(o.customerPhone ?? ''),
        escCsv(o.orderNumber),
        escCsv(o.projectTitle ?? ''),
        escCsv(formatLinesDetail(detailLines)),
        scopedAmt.toFixed(2),
        escCsv(o.status),
        escCsv(proofExportLabel(o)),
      ].join(',')
    );
  }
  return outLines.join('\n');
}
