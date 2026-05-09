import type { OrderAppendBatchDoc, OrderDoc, OrderLineDoc } from '../types/firestore';
import { listOrderCardPaymentApplications } from './orderCardPaymentApplications';
import { parseScreenshotEntries, type ParsedScreenshotEntry } from './paymentScreenshotHelpers';

export type PaymentGroupStatus = 'unpaid' | 'pending' | 'confirmed';

type Segment = {
  key: string;
  timeMs: number;
  lines: OrderLineDoc[];
  subtotal: number;
  confirmed: boolean;
  appendBatchId: string | null;
};

type ActionBucket = {
  key: string;
  stageIdx: number;
  atMs: number;
  proofs: ParsedScreenshotEntry[];
  hasCardAuto: boolean;
};

export type PaymentGroup = {
  id: string;
  status: PaymentGroupStatus;
  timeMs: number;
  lines: OrderLineDoc[];
  subtotal: number;
  proofs: ParsedScreenshotEntry[];
  hasCardAuto: boolean;
  appendBatchIds: string[];
  includesInitial: boolean;
};

function sumLines(lines: OrderLineDoc[]): number {
  return lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
}

function getInitialLines(order: OrderDoc): OrderLineDoc[] {
  if (order.initialLines?.length) return order.initialLines;
  return order.lines ?? [];
}

function getInitialTotal(order: OrderDoc, initialLines: OrderLineDoc[]): number {
  if (typeof order.initialTotalAmount === 'number') return Number(order.initialTotalAmount) || 0;
  return sumLines(initialLines);
}

function buildSegments(order: OrderDoc): Segment[] {
  const initialLines = getInitialLines(order);
  const initialTotal = getInitialTotal(order, initialLines);
  const segments: Segment[] = [
    {
      key: 'initial',
      timeMs: order.createdAt?.toMillis?.() ?? 0,
      lines: initialLines,
      subtotal: initialTotal,
      confirmed: Boolean(order.initialPaymentConfirmedAt),
      appendBatchId: null,
    },
  ];

  const batches = [...(order.appendBatches ?? [])].sort(
    (a, b) => (a.appendedAt?.toMillis?.() ?? 0) - (b.appendedAt?.toMillis?.() ?? 0)
  );
  for (const b of batches) {
    segments.push({
      key: `append:${b.id}`,
      timeMs: b.appendedAt?.toMillis?.() ?? 0,
      lines: b.lines ?? [],
      subtotal: Number(b.deltaAmount) || 0,
      confirmed: Boolean(b.confirmedAt),
      appendBatchId: b.id,
    });
  }
  return segments;
}

function stageIndexByTime(segments: Segment[], atMs: number): number {
  let idx = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.timeMs <= atMs) idx = i;
    else break;
  }
  return idx;
}

function stageIndexByBatch(segments: Segment[], appendBatchId: string): number {
  const idx = segments.findIndex((s) => s.appendBatchId === appendBatchId);
  return idx >= 0 ? idx : 0;
}

function upsertBucket(
  buckets: Map<string, ActionBucket>,
  key: string,
  stageIdx: number,
  atMs: number,
  proof: ParsedScreenshotEntry | null,
  hasCardAuto = false
) {
  const hit = buckets.get(key);
  if (!hit) {
    buckets.set(key, {
      key,
      stageIdx,
      atMs,
      proofs: proof ? [proof] : [],
      hasCardAuto,
    });
    return;
  }
  hit.stageIdx = Math.max(hit.stageIdx, stageIdx);
  hit.atMs = Math.min(hit.atMs, atMs);
  if (proof) hit.proofs.push(proof);
  if (hasCardAuto) hit.hasCardAuto = true;
}

function buildActionBuckets(order: OrderDoc, segments: Segment[]): ActionBucket[] {
  const proofs = parseScreenshotEntries(order.paymentScreenshots).filter(
    (p) => Boolean(p.url) || p.waivedNoScreenshot
  );
  const buckets = new Map<string, ActionBucket>();

  for (const p of proofs) {
    const atMs = p.uploadedAt?.toMillis?.() ?? 0;
    if (p.appendBatchId) {
      const idx = stageIndexByBatch(segments, p.appendBatchId);
      upsertBucket(buckets, `batch:${p.appendBatchId}`, idx, atMs, p);
      continue;
    }
    const idx = stageIndexByTime(segments, atMs);
    upsertBucket(buckets, `time-stage:${idx}`, idx, atMs, p);
  }

  const cardApps = listOrderCardPaymentApplications(order);
  for (let i = 0; i < cardApps.length; i++) {
    const cardAt = cardApps[i]?.appliedAt?.toMillis?.();
    if (typeof cardAt !== 'number') continue;
    const idx = stageIndexByTime(segments, cardAt);
    upsertBucket(buckets, `card:${i}:${cardAt}`, idx, cardAt, null, true);
  }

  return [...buckets.values()].sort((a, b) => {
    if (a.stageIdx !== b.stageIdx) return a.stageIdx - b.stageIdx;
    return a.atMs - b.atMs;
  });
}

function segmentStatus(segments: Segment[]): PaymentGroupStatus {
  if (segments.length === 0) return 'unpaid';
  return segments.every((s) => s.confirmed) ? 'confirmed' : 'pending';
}

function collectAppendBatchIds(segments: Segment[]): string[] {
  return segments.map((s) => s.appendBatchId).filter((x): x is string => Boolean(x));
}

export function buildPaymentGroups(order: OrderDoc): PaymentGroup[] {
  const segments = buildSegments(order);
  if (segments.length === 0) return [];
  const actions = buildActionBuckets(order, segments);
  if (actions.length === 0) {
    return [
      {
        id: 'group-1',
        status: 'unpaid',
        timeMs: segments[0]!.timeMs,
        lines: segments.flatMap((s) => s.lines),
        subtotal: segments.reduce((s, x) => s + x.subtotal, 0),
        proofs: [],
        hasCardAuto: false,
        appendBatchIds: collectAppendBatchIds(segments),
        includesInitial: true,
      },
    ];
  }

  const groups: PaymentGroup[] = [];
  let cursor = 0;
  for (const action of actions) {
    const end = Math.max(cursor, action.stageIdx);
    const segs = segments.slice(cursor, end + 1);
    if (segs.length === 0) continue;
    groups.push({
      id: `group-${groups.length + 1}`,
      status: action.hasCardAuto ? 'confirmed' : segmentStatus(segs),
      timeMs: segs[0]!.timeMs,
      lines: segs.flatMap((s) => s.lines),
      subtotal: segs.reduce((s, x) => s + x.subtotal, 0),
      proofs: action.proofs,
      hasCardAuto: action.hasCardAuto,
      appendBatchIds: collectAppendBatchIds(segs),
      includesInitial: segs.some((s) => s.key === 'initial'),
    });
    cursor = end + 1;
  }

  if (cursor < segments.length) {
    const segs = segments.slice(cursor);
    groups.push({
      id: `group-${groups.length + 1}`,
      status: 'unpaid',
      timeMs: segs[0]!.timeMs,
      lines: segs.flatMap((s) => s.lines),
      subtotal: segs.reduce((s, x) => s + x.subtotal, 0),
      proofs: [],
      hasCardAuto: false,
      appendBatchIds: collectAppendBatchIds(segs),
      includesInitial: segs.some((s) => s.key === 'initial'),
    });
  }

  return groups;
}

export function batchTimeStr(batch: OrderAppendBatchDoc): string {
  const d = batch.appendedAt?.toDate?.();
  if (!d) return '';
  return d.toLocaleString();
}
