import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { PaymentScreenshotsPanel } from '../../components/merchant/PaymentScreenshotsPanel';
import { ActionButton } from '../../components/ui/ActionButton';
import { EmptyStateCard } from '../../components/ui/EmptyStateCard';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  canMerchantConfirmAppendBatchByScreenshots,
  hasPaymentScreenshotForAppendBatch,
} from '../../lib/paymentScreenshotHelpers';
import { orderHasNoPaymentActionYet } from '../../lib/paymentGrouping';
import { deriveDisplayOrderStatus } from '../../lib/paymentGroupView';
import {
  getOrderByNumber,
  merchantAppendInternalNote,
  merchantConfirmAppendBatch,
  merchantConfirmPayment,
  merchantConfirmPendingAppendBatches,
  merchantWaiveInitialPaymentScreenshot,
  merchantWaiveAppendBatchScreenshot,
  type OrderRow,
} from '../../lib/orderService';
import {
  cardApplicationsForAppendBatch,
  listOrderCardPaymentApplications,
} from '../../lib/orderCardPaymentApplications';
import type {
  OrderAppendBatchDoc,
  OrderCardPaymentDoc,
  OrderDoc,
  OrderLineDoc,
} from '../../types/firestore';

const statusLabel: Record<string, string> = {
  unpaid: '待付款',
  pending: '待确认',
  confirmed: '已确认付款',
  partial_paid: '待付款',
  cancelled: '已取消',
};

function toChipTone(
  s: string
): 'confirmed' | 'pending' | 'unpaid' | 'cancelled' | 'neutral' {
  if (s === 'confirmed') return 'confirmed';
  if (s === 'pending') return 'pending';
  if (s === 'unpaid' || s === 'partial_paid') return 'unpaid';
  if (s === 'cancelled') return 'cancelled';
  return 'neutral';
}

function isNoteEntry(
  x: unknown
): x is { body: string; userId: string; createdAt: { toDate: () => Date } } {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const ca = o.createdAt as { toDate?: () => Date } | undefined;
  return (
    typeof o.body === 'string' &&
    typeof o.userId === 'string' &&
    typeof ca?.toDate === 'function'
  );
}

function batchTimeStr(b: OrderAppendBatchDoc): string {
  const d = b.appendedAt?.toDate?.();
  if (!d) return '';
  return d.toLocaleString();
}

function linePromoTag(line: OrderLineDoc) {
  if (!line.isDiscount) return null;
  const isEarlyBird =
    typeof line.discountEndsAt === 'string' && line.discountEndsAt.trim().length > 0;
  return (
    <span
      className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        isEarlyBird ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-900'
      }`}
    >
      {isEarlyBird ? '早鸟价' : '特惠价'}
    </span>
  );
}

function aggregateOrderLines(lines: OrderLineDoc[]): OrderLineDoc[] {
  const grouped = new Map<string, OrderLineDoc>();
  for (const line of lines) {
    const key = [
      line.productId,
      line.name,
      Number(line.unitPrice ?? 0).toFixed(2),
      line.isDiscount ? '1' : '0',
      line.discountEndsAt ?? '',
    ].join('|');
    const exist = grouped.get(key);
    if (!exist) {
      grouped.set(key, { ...line });
      continue;
    }
    grouped.set(key, {
      ...exist,
      quantity: Number(exist.quantity ?? 0) + Number(line.quantity ?? 0),
      subtotal: Number(exist.subtotal ?? 0) + Number(line.subtotal ?? 0),
    });
  }
  return Array.from(grouped.values());
}

/** 已入账的历史支付组（商户曾逐笔确认过的批次） */
function CardPaymentBreakdown({
  cardPayment,
  lines,
  title = '本组为卡支付自动确认（无需截图）',
}: {
  cardPayment: OrderCardPaymentDoc;
  lines: OrderLineDoc[];
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {cardPayment.passCards.map((c) => (
          <li key={c.customerCardId}>
            · 次卡 #{c.customerCardId.slice(0, 6)} — 抵扣 {c.uses} 次（
            {c.appliedLineProductIds
              .map((pid) => lines.find((l) => l.productId === pid)?.name ?? '行')
              .join('、')}
            ）
          </li>
        ))}
        {cardPayment.wallet ? (
          <li>· 钱包扣减 RM {Number(cardPayment.wallet.deduct ?? 0).toFixed(2)}</li>
        ) : null}
        <li className="pt-1 font-semibold">
          共抵扣 RM {Number(cardPayment.totalDeducted ?? 0).toFixed(2)}
        </li>
      </ul>
    </div>
  );
}

function ConfirmedAppendBatchCard({
  order,
  batch,
  groupNumber,
  paymentScreenshots,
  orderLines,
}: {
  order: OrderDoc;
  batch: OrderAppendBatchDoc;
  groupNumber: number;
  paymentScreenshots: unknown;
  orderLines: OrderLineDoc[];
}) {
  const hasBatchProof = hasPaymentScreenshotForAppendBatch(paymentScreenshots, batch.id);
  const isCardAutoConfirmed = batch.confirmedByUserId === 'customer_card_auto';
  const allCardApps = listOrderCardPaymentApplications(order);
  let batchCardApps = cardApplicationsForAppendBatch(order, batch.id);
  if (
    batchCardApps.length === 0 &&
    isCardAutoConfirmed &&
    allCardApps.length === 1
  ) {
    batchCardApps = allCardApps;
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">支付组 {groupNumber}（已确认）</h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
          已确认收款
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-600">时间：{batchTimeStr(batch)}</p>
      {batch.confirmedAt ? (
        <p className="mb-2 text-xs text-emerald-800">
          商户已于 {batch.confirmedAt.toDate().toLocaleString()} 确认收款
        </p>
      ) : null}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
        {aggregateOrderLines(batch.lines).map((l, idx) => (
          <li
            key={`${batch.id}-${l.productId}-${idx}`}
            className="flex justify-between gap-2 px-3 py-2 text-sm"
          >
            <span>
              {l.name}
              {linePromoTag(l)} ×{l.quantity}
            </span>
            <span className="tabular-nums font-medium">
              {formatMYR(l.subtotal)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
        <span>本笔小计</span>
        <span>{formatMYR(batch.deltaAmount)}</span>
      </div>
      <div className="mt-3">
        <h3 className="mb-1 text-xs font-semibold text-gray-700">付款凭证</h3>
        {isCardAutoConfirmed && !hasBatchProof && batchCardApps.length > 0 ? (
          <div className="space-y-2">
            {batchCardApps.map((cp, i) => (
              <CardPaymentBreakdown
                key={`${cp.appliedAt?.toMillis?.() ?? 0}-${i}`}
                cardPayment={cp}
                lines={orderLines}
                title={
                  batchCardApps.length > 1
                    ? `本组卡支付自动确认（第 ${i + 1} 笔）`
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <PaymentScreenshotsPanel
            paymentScreenshots={paymentScreenshots}
            appendBatchIdFilter={batch.id}
            emptyHint="暂无该笔截图记录。"
          />
        )}
      </div>
    </div>
  );
}

export default function MerchantOrderDetail() {
  const { shopSlug = '', projectId = '', orderNumber = '' } = useParams<{
    shopSlug: string;
    projectId: string;
    orderNumber: string;
  }>();
  const slug = decodeURIComponent(shopSlug);
  const pid = decodeURIComponent(projectId);
  const onum = decodeURIComponent(orderNumber);

  const { user, loading: authLoading } = useAuthUser();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<OrderRow | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState<
    | 'confirm'
    | 'confirm_all'
    | 'note'
    | 'confirm_append_single'
    | 'waive_append_proof'
    | 'waive_initial_proof'
    | null
  >(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await getOrderByNumber(pid, onum);
      if (!r || r.data.shopSlug !== slug) {
        setRow(null);
        setErr('订单不存在或不属于当前店铺');
        return;
      }
      setRow(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [onum, pid, slug]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handleConfirmAll = async (includeInitialPayment = false) => {
    if (!user || !row) return;
    setBusy('confirm_all');
    setMsg(null);
    try {
      await merchantConfirmPendingAppendBatches(row.id, user.uid, {
        includeInitialPayment,
      });
      setMsg('已确认全部收款');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async () => {
    if (!user || !row) return;
    setBusy('confirm');
    setMsg(null);
    try {
      await merchantConfirmPayment(row.id, user.uid);
      setMsg('已确认该支付组收款');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleConfirmAppendBatch = async (
    appendBatchId: string,
    includeInitialPayment = false
  ) => {
    if (!user || !row) return;
    setBusy('confirm_append_single');
    setMsg(null);
    try {
      await merchantConfirmAppendBatch(row.id, appendBatchId, user.uid, {
        includeInitialPayment,
      });
      setMsg('已确认该支付组收款');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleWaiveAppendProof = async (appendBatchId: string) => {
    if (!user || !row) return;
    setBusy('waive_append_proof');
    setMsg(null);
    try {
      await merchantWaiveAppendBatchScreenshot(row.id, appendBatchId, user.uid);
      setMsg('该组已设为免提交付款凭证，现可进行确认');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleWaiveInitialProof = async () => {
    if (!user || !row) return;
    setBusy('waive_initial_proof');
    setMsg(null);
    try {
      await merchantWaiveInitialPaymentScreenshot(row.id, user.uid);
      setMsg('该支付组已设为免提交付款凭证，现可进行确认');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleNote = async () => {
    if (!user || !row) return;
    setBusy('note');
    setMsg(null);
    try {
      await merchantAppendInternalNote(row.id, user.uid, noteDraft);
      setNoteDraft('');
      setMsg('备注已保存');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(null);
    }
  };

  const baseOrders = `/dashboard/${encodeURIComponent(slug)}/orders`;
  const customerUrl = `/shop/${encodeURIComponent(slug)}/${encodeURIComponent(pid)}/orders/${encodeURIComponent(onum)}`;

  if (authLoading || loading) {
    return (
      <PageShell title="订单详情" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="订单详情" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/login">
          登录
        </Link>
      </PageShell>
    );
  }

  if (err || !row) {
    return (
      <PageShell title="订单详情" subtitle="错误">
        <p className="text-sm text-red-600">{err ?? '未找到订单'}</p>
        <Link
          to={baseOrders}
          className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline"
        >
          返回订单列表
        </Link>
      </PageShell>
    );
  }

  const order: OrderDoc = row.data;
  const displayStatus = deriveDisplayOrderStatus(order);
  const created = order.createdAt?.toDate?.() ?? new Date();
  const timeStr = `${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;

  const appendBatches = order.appendBatches ?? [];
  const legacyNoSplit =
    appendBatches.length > 0 && !(order.initialLines?.length ?? 0);

  const initialLines: OrderLineDoc[] = legacyNoSplit
    ? order.lines
    : order.initialLines?.length
      ? order.initialLines
      : order.lines;
  const initialTotal =
    order.initialTotalAmount ??
    initialLines.reduce((s, l) => s + l.subtotal, 0);

  const firstPaymentAcknowledged = !!order.initialPaymentConfirmedAt;

  const cardAppsAll = listOrderCardPaymentApplications(order);
  let initialSegmentCardApps = cardAppsAll.filter((a) =>
    Boolean(a.cardSettlementScope?.includesInitialSegment)
  );
  if (initialSegmentCardApps.length === 0 && cardAppsAll.length === 1) {
    initialSegmentCardApps = cardAppsAll;
  }

  const confirmedBatches = appendBatches
    .filter((b) => b.confirmedAt)
    .sort(
      (a, b) =>
        (a.appendedAt?.toMillis?.() ?? 0) -
        (b.appendedAt?.toMillis?.() ?? 0)
    );
  const firstActionMergedBatches =
    order.initialPaymentConfirmedAt && confirmedBatches.length > 0
      ? confirmedBatches.filter(
          (b) =>
            Math.abs(
              (b.confirmedAt?.toMillis?.() ?? 0) -
                (order.initialPaymentConfirmedAt?.toMillis?.() ?? 0)
            ) <= 1000
        )
      : [];
  const restConfirmedBatches = confirmedBatches.filter(
    (b) => !firstActionMergedBatches.some((x) => x.id === b.id)
  );
  const pendingBatches = appendBatches.filter((b) => !b.confirmedAt);
  const pendingIds = pendingBatches.map((b) => b.id);
  const firstGroupHasProof = Array.isArray(order.paymentScreenshots)
    ? order.paymentScreenshots.some((raw) => {
        if (!raw || typeof raw !== 'object') return false;
        const o = raw as Record<string, unknown>;
        const url = typeof o.url === 'string' ? o.url.trim() : '';
        const bid =
          typeof o.appendBatchId === 'string' ? o.appendBatchId.trim() : '';
        const waived = o.waivedNoScreenshot === true;
        return !bid && (Boolean(url) || waived);
      })
    : false;
  const canConfirmWhole =
    !firstPaymentAcknowledged &&
    firstGroupHasProof &&
    (order.status === 'unpaid' ||
      order.status === 'pending' ||
      order.status === 'partial_paid');
  /** 分组优先级：待确认(0) > 待付款(1) > 已确认(2) */
  const firstGroupPriority = firstPaymentAcknowledged
    ? 2
    : order.status === 'pending'
      ? 0
      : 1;
  const pendingBatchGroups = pendingBatches
    .map((b) => {
      const hasTagged = hasPaymentScreenshotForAppendBatch(
        order.paymentScreenshots,
        b.id
      );
      const canConfirm = canMerchantConfirmAppendBatchByScreenshots(
        order.paymentScreenshots,
        b.id,
        pendingIds,
        b.appendedAt
      );
      const includeUntagged = pendingIds.length === 1 && !hasTagged;
      const groupPriority = canConfirm ? 0 : 1;
      return { batch: b, canConfirm, includeUntagged, groupPriority };
    })
    .sort((a, b) => {
      if (a.groupPriority !== b.groupPriority) {
        return a.groupPriority - b.groupPriority;
      }
      return (
        (a.batch.appendedAt?.toMillis?.() ?? 0) -
        (b.batch.appendedAt?.toMillis?.() ?? 0)
      );
    });
  const pendingHasTaggedProof = pendingBatches.some((b) =>
    hasPaymentScreenshotForAppendBatch(order.paymentScreenshots, b.id)
  );
  const initialMergeTargetBatchId = null;
  const hideStandaloneFirstGroup = Boolean(initialMergeTargetBatchId);

  // 同一次支付动作覆盖全部待付（首单+所有加购）时，只需一次确认
  const canConfirmAllInOneAction =
    !firstPaymentAcknowledged &&
    firstGroupHasProof &&
    pendingBatches.length > 0 &&
    !pendingHasTaggedProof &&
    pendingBatchGroups.every((g) => g.canConfirm) &&
    (order.status === 'unpaid' || order.status === 'pending' || order.status === 'partial_paid');

  // 还未发生支付动作时（首单+加购都未传图），也应按一个待付款组展示
  const canShowAllAsSingleUnpaidGroup =
    orderHasNoPaymentActionYet(order) &&
    pendingBatches.length > 0 &&
    pendingBatchGroups.every((g) => !g.canConfirm) &&
    (order.status === 'unpaid' || order.status === 'pending' || order.status === 'partial_paid');

  const allPendingTotal =
    (canConfirmAllInOneAction || canShowAllAsSingleUnpaidGroup
      ? initialTotal + pendingBatches.reduce((s, b) => s + (Number(b.deltaAmount) || 0), 0)
      : 0);
  const allPendingMergedLines = aggregateOrderLines([
    ...initialLines,
    ...pendingBatches.flatMap((b) => b.lines),
  ]);
  const showSingleConfirmedGroup =
    Boolean(order.initialPaymentConfirmedAt) &&
    firstActionMergedBatches.length > 0 &&
    pendingBatches.length === 0 &&
    restConfirmedBatches.length === 0;
  const confirmedGroupLines =
    firstActionMergedBatches.length > 0
      ? [...initialLines, ...firstActionMergedBatches.flatMap((b) => b.lines)]
      : initialLines;
  const confirmedGroupTotal =
    firstActionMergedBatches.length > 0
      ? Number(initialTotal) +
        firstActionMergedBatches.reduce(
          (s, b) => s + (Number(b.deltaAmount) || 0),
          0
        )
      : initialTotal;
  const confirmedMergedBatchIds = firstActionMergedBatches.map((b) => b.id);

  const pendingGroupPriority = pendingBatchGroups.length > 0
    ? pendingBatchGroups[0]!.groupPriority
    : null;
  const pendingHasUnpaidGroup = pendingBatchGroups.some((g) => !g.canConfirm);
  const firstGroupTimeMs = order.createdAt?.toMillis?.() ?? 0;
  const pendingGroupTimeMs =
    pendingBatchGroups[0]?.batch.appendedAt?.toMillis?.() ??
    Number.MAX_SAFE_INTEGER;
  const showPendingBeforeFirst =
    pendingGroupPriority !== null &&
    (pendingGroupPriority < firstGroupPriority ||
      (pendingGroupPriority === firstGroupPriority &&
        pendingGroupTimeMs < firstGroupTimeMs));
  const pendingStartNumber = showPendingBeforeFirst ? 1 : hideStandaloneFirstGroup ? 1 : 2;
  const firstGroupNumber = showPendingBeforeFirst ? pendingBatchGroups.length + 1 : 1;
  const confirmedStartNumber = (() => {
    let n = 1;
    if (showPendingBeforeFirst) n += pendingBatchGroups.length;
    if (!hideStandaloneFirstGroup) n += 1;
    if (!showPendingBeforeFirst) n += pendingBatchGroups.length;
    return n;
  })();

  const pendingSection = pendingBatchGroups.length > 0 ? (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-amber-950">
        待确认支付组（按提交凭证行为分组；每组独立确认）
      </h2>
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        {pendingBatchGroups.map(({ batch, canConfirm, includeUntagged }, index) => {
          const includeInitialInThisGroup = initialMergeTargetBatchId === batch.id;
          const groupLines = includeInitialInThisGroup
            ? [...initialLines, ...batch.lines]
            : batch.lines;
          const groupAmount = includeInitialInThisGroup
            ? Number(initialTotal || 0) + Number(batch.deltaAmount || 0)
            : Number(batch.deltaAmount || 0);
          return (
            <div
              key={batch.id}
              className="rounded-xl border border-amber-100 bg-white px-3 py-3"
            >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                {includeInitialInThisGroup
                  ? `支付组 ${pendingStartNumber + index}（含本次动作对应明细）`
                  : `支付组 ${pendingStartNumber + index}`}
              </h3>
              {canConfirm ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
                  已传图 · 请核对
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
                  待付款（未传图）
                </span>
              )}
            </div>
            <p className="mb-2 text-xs text-gray-600">时间：{batchTimeStr(batch)}</p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
              {aggregateOrderLines(groupLines).map((l, idx) => (
                <li
                  key={`${batch.id}-${l.productId}-${idx}`}
                  className="flex justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {l.name}
                    {linePromoTag(l)} ×{l.quantity}
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatMYR(l.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
              <span>本组小计</span>
              <span>{formatMYR(groupAmount)}</span>
            </div>
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-semibold text-gray-700">付款凭证</h3>
              <PaymentScreenshotsPanel
                paymentScreenshots={order.paymentScreenshots}
                appendBatchIdFilter={batch.id}
                includeUntagged={includeUntagged}
                untaggedNotBeforeMillis={batch.appendedAt.toMillis()}
                emptyHint="该支付组尚未上传对应付款截图。"
                emptyAction={
                  !canConfirm &&
                  order.status !== 'cancelled' &&
                  order.status !== 'confirmed' ? (
                    <ActionButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void handleWaiveAppendProof(batch.id)}
                    >
                      {busy === 'waive_append_proof'
                        ? '处理中…'
                        : '免提交付款凭证'}
                    </ActionButton>
                  ) : null
                }
              />
            </div>
            {order.status !== 'cancelled' && order.status !== 'confirmed' ? (
              <>
                <ActionButton
                  type="button"
                  variant="primary"
                  fullWidth
                  disabled={busy !== null || !canConfirm}
                  className="mt-3 h-11"
                  onClick={() =>
                    void handleConfirmAppendBatch(
                      batch.id,
                      false
                    )
                  }
                >
                  {busy === 'confirm_append_single'
                    ? '处理中…'
                    : `确认本组收款（${formatMYR(groupAmount)}）`}
                </ActionButton>
                {!canConfirm ? (
                  <p className="mt-2 text-xs text-amber-950">
                    顾客尚未上传该支付组有效付款截图，请先让顾客在订单页上传。
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-xs text-gray-600">
                当前状态不可确认该支付组收款。
              </p>
            )}
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <PageShell title={`订单 #${order.orderNumber}`} subtitle={order.projectTitle}>
      {msg ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}
      {busy === 'confirm' ||
      busy === 'confirm_all' ||
      busy === 'confirm_append_single' ? (
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          正在向服务器写入确认结果，弱网下可能需要十余秒，请勿关闭页面或重复点击。
        </p>
      ) : null}

      <div className="space-y-4 text-sm text-gray-800">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-bold">#{order.orderNumber}</div>
            <StatusChip
              tone={toChipTone(displayStatus)}
              label={statusLabel[displayStatus] ?? displayStatus}
            />
          </div>
          <p className="mt-1 text-sm">下单时间：{timeStr}</p>
          <p className="mt-1">
            应付：<strong>{formatMYR(order.totalAmount)}</strong>
            {order.status === 'confirmed' || order.status === 'partial_paid' ? (
              <span className="ml-2 text-emerald-800">
                （已收 {formatMYR(order.paidAmount)} · 待收{' '}
                {formatMYR(order.pendingAmount)}）
              </span>
            ) : null}
          </p>
          {order.status === 'partial_paid' &&
          pendingIds.length > 0 &&
          pendingHasUnpaidGroup ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-950">
              当前支付组尚未收到有效付款截图，视同 <strong>待付款</strong>
              ：请先让顾客在手机端上传补款截图后再确认。
            </p>
          ) : null}
        </div>

        {legacyNoSplit ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            此单为历史数据，支付动作快照未完整拆分；下方支付组仍以批次为准核对补款。
          </p>
        ) : null}

        {/* ── 合并确认区块：同一次支付动作覆盖首单+所有加购时，一次确认 ── */}
        {canConfirmAllInOneAction ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-sky-950">
                支付组 1（本次付款明细）
              </h2>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
                已传图 · 待确认
              </span>
            </div>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
              {allPendingMergedLines.map((l, idx) => (
                <li
                  key={`pending-all-${l.productId}-${idx}`}
                  className="flex justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {l.name}
                    {linePromoTag(l)} ×{l.quantity}
                  </span>
                  <span className="tabular-nums font-medium">{formatMYR(l.subtotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
              <span>合计应收</span>
              <span>{formatMYR(allPendingTotal)}</span>
            </div>
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-semibold text-gray-700">付款凭证</h3>
              <PaymentScreenshotsPanel
                paymentScreenshots={order.paymentScreenshots}
                appendBatchIdFilter={null}
                emptyHint="暂无截图。"
              />
            </div>
            <ActionButton
              type="button"
              variant="primary"
              fullWidth
              disabled={busy !== null}
              className="mt-3 h-11"
              onClick={() => void handleConfirmAll(true)}
            >
              {busy === 'confirm_all'
                ? '处理中…'
                : `确认全部收款（${formatMYR(allPendingTotal)}）`}
            </ActionButton>
            <p className="mt-2 text-xs text-gray-600">
              本次付款一张凭证覆盖当前支付组明细，点击后一次性确认本组。
            </p>
          </div>
        ) : canShowAllAsSingleUnpaidGroup ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-amber-950">
                支付组 1（待付款明细）
              </h2>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
                待付款（未传图）
              </span>
            </div>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
              {allPendingMergedLines.map((l, idx) => (
                <li
                  key={`unpaid-all-${l.productId}-${idx}`}
                  className="flex justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {l.name}
                    {linePromoTag(l)} ×{l.quantity}
                  </span>
                  <span className="tabular-nums font-medium">{formatMYR(l.subtotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
              <span>合计应收</span>
              <span>{formatMYR(allPendingTotal)}</span>
            </div>
            <div className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">当前尚未发起支付动作</p>
              <p className="mt-1">
                可让顾客上传一张凭证，或使用「免提交付款凭证」一次性覆盖本次支付组。
              </p>
            </div>
            {order.status !== 'cancelled' && order.status !== 'confirmed' ? (
              <ActionButton
                type="button"
                variant="secondary"
                fullWidth
                disabled={busy !== null}
                className="mt-3 h-11"
                onClick={() => void handleWaiveInitialProof()}
              >
                {busy === 'waive_initial_proof'
                  ? '处理中…'
                  : `本次免提交付款凭证（${formatMYR(allPendingTotal)}）`}
              </ActionButton>
            ) : null}
          </div>
        ) : (
          <>
            {showPendingBeforeFirst ? pendingSection : null}

            {!hideStandaloneFirstGroup ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">
                  {showSingleConfirmedGroup
                    ? `支付组 ${firstGroupNumber}（已确认）`
                    : `支付组 ${firstGroupNumber}`}
                </h2>
                {firstPaymentAcknowledged ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                    已确认收款
                  </span>
                ) : firstGroupHasProof ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
                    已传图 · 待确认
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
                    待付款（未传图）
                  </span>
                )}
              </div>
              <p className="mb-2 text-xs text-gray-600">时间：{timeStr}</p>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                {aggregateOrderLines(confirmedGroupLines).map((l, idx) => (
                  <li
                    key={`${l.productId}-${idx}`}
                    className="flex justify-between gap-2 px-3 py-2"
                  >
                    <span>
                      {l.name}
                      {linePromoTag(l)} ×{l.quantity}
                    </span>
                    <span className="tabular-nums font-medium">
                      {formatMYR(l.subtotal)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
                <span>本组小计</span>
                <span>{formatMYR(confirmedGroupTotal)}</span>
              </div>
              <div className="mt-3">
                <h3 className="mb-1 text-xs font-semibold text-gray-700">
                  本组相关截图（未挂批次的图）
                </h3>
                {initialSegmentCardApps.length > 0 &&
                firstPaymentAcknowledged &&
                !firstGroupHasProof ? (
                  <div className="space-y-2">
                    {initialSegmentCardApps.map((cp, i) => (
                      <CardPaymentBreakdown
                        key={`${cp.appliedAt?.toMillis?.() ?? 0}-${i}`}
                        cardPayment={cp}
                        lines={initialLines}
                        title={
                          initialSegmentCardApps.length > 1
                            ? `本组卡支付自动确认（第 ${i + 1} 笔）`
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <PaymentScreenshotsPanel
                    paymentScreenshots={order.paymentScreenshots}
                    {...(confirmedMergedBatchIds.length > 0
                      ? {
                          matchAnyAppendBatchIds: confirmedMergedBatchIds,
                          includeUntagged: true,
                          untaggedNotBeforeMillis: order.createdAt?.toMillis?.() ?? 0,
                        }
                      : { appendBatchIdFilter: null })}
                    emptyHint="暂无本组截图。"
                    emptyAction={
                      !firstPaymentAcknowledged &&
                      !firstGroupHasProof &&
                      order.status !== 'cancelled' &&
                      order.status !== 'confirmed' ? (
                        <ActionButton
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void handleWaiveInitialProof()}
                        >
                          {busy === 'waive_initial_proof' ? '处理中…' : '免提交付款凭证'}
                        </ActionButton>
                      ) : null
                    }
                  />
                )}
              </div>
              {canConfirmWhole ? (
                <>
                  <ActionButton
                    type="button"
                    variant="primary"
                    fullWidth
                    disabled={busy !== null}
                    className="mt-3 h-11"
                    onClick={() => void handleConfirm()}
                  >
                    {busy === 'confirm'
                      ? '处理中…'
                      : `确认本组收款（${formatMYR(initialTotal)}）`}
                  </ActionButton>
                  <p className="mt-2 text-xs text-gray-600">
                    本组对应顾客该次付款提交（可多张凭证）。确认后若仍有未确认分组，会保留待收部分到后续组。
                  </p>
                </>
              ) : order.status === 'confirmed' ? (
                <p className="mt-2 text-xs text-gray-600">本组已完成确认。</p>
              ) : null}
            </div>
            ) : null}

            {!showPendingBeforeFirst ? pendingSection : null}
          </>
        )}

        {!showSingleConfirmedGroup && restConfirmedBatches.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">已确认支付组</h2>
            {restConfirmedBatches.map((b, index) => (
              <ConfirmedAppendBatchCard
                key={b.id}
                order={order}
                batch={b}
                groupNumber={confirmedStartNumber + index}
                paymentScreenshots={order.paymentScreenshots}
                orderLines={order.lines}
              />
            ))}
          </div>
        ) : !showSingleConfirmedGroup ? (
          <EmptyStateCard title="暂无已确认的支付组" className="py-4" />
        ) : null}

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">订单当前合计</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {aggregateOrderLines(order.lines).map((l, idx) => (
              <li
                key={`${l.productId}-all-${idx}`}
                className="flex justify-between gap-2 px-3 py-2"
              >
                <span>
                  {l.name}
                  {linePromoTag(l)} ×{l.quantity}
                </span>
                <span className="tabular-nums font-medium">
                  {formatMYR(l.subtotal)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
            <span>应付合计</span>
            <span>{formatMYR(order.totalAmount)}</span>
          </div>
          {cardAppsAll.length > 0 ? (
            <div className="mt-2 space-y-3">
              {cardAppsAll.map((cp, ci) => (
                <div
                  key={`sum-card-${ci}-${cp.appliedAt?.toMillis?.() ?? 0}`}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
                >
                  <p className="font-semibold">
                    卡支付（系统已抵扣）
                    {cardAppsAll.length > 1 ? ` · 第 ${ci + 1} 笔` : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {cp.passCards.map((c) => (
                      <li key={`${ci}-${c.customerCardId}-${c.ledgerId}`}>
                        · 次卡 #{c.customerCardId.slice(0, 6)} — 抵扣 {c.uses}{' '}
                        次（
                        {c.appliedLineProductIds
                          .map(
                            (pid) =>
                              order.lines.find((l) => l.productId === pid)?.name ??
                              '行'
                          )
                          .join('、')}
                        ）
                      </li>
                    ))}
                    {cp.wallet ? (
                      <li>
                        · 钱包扣减 RM{' '}
                        {Number(cp.wallet.deduct ?? 0).toFixed(2)}
                      </li>
                    ) : null}
                    <li className="pt-1 font-semibold">
                      共抵扣 RM {Number(cp.totalDeducted ?? 0).toFixed(2)}
                    </li>
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">配送</h2>
          <p className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            {order.deliveryPointSnapshot?.name ?? '未填写'}
          </p>
          {order.deliveryPointSnapshot?.detail ? (
            <p className="mt-1 text-xs text-gray-600">
              {order.deliveryPointSnapshot.detail}
            </p>
          ) : null}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">顾客</h2>
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <p>姓名：{order.customerName}</p>
            <p>电话：{order.customerPhone}</p>
            <p>地址：{order.customerAddress}</p>
            <p>备注：{order.customerNote ?? '（无）'}</p>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            内部备注（仅管理员）
          </h2>
          <ul className="mb-2 space-y-2">
            {Array.isArray(order.internalNotes) && order.internalNotes.length > 0
              ? order.internalNotes.map((n, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-700"
                  >
                    {isNoteEntry(n) ? (
                      <>
                        <p>{n.body}</p>
                        <p className="mt-1 text-gray-400">
                          {n.createdAt?.toDate?.()?.toLocaleString?.() ?? ''}{' '}
                          · {n.userId.slice(0, 8)}…
                        </p>
                      </>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans">
                        {JSON.stringify(n)}
                      </pre>
                    )}
                  </li>
                ))
              : (
                  <li className="text-xs text-gray-500">暂无备注</li>
                )}
          </ul>
          <textarea
            className="mb-2 min-h-[4rem] w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900"
            placeholder="添加内部备注…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <ActionButton
            type="button"
            variant="primary"
            disabled={busy !== null || !noteDraft.trim()}
            onClick={() => void handleNote()}
          >
            {busy === 'note' ? '保存中…' : '保存备注'}
          </ActionButton>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            to={baseOrders}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
          >
            返回订单列表
          </Link>
          <Link
            to={customerUrl}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-dashed border-gray-300 px-4 text-sm font-medium text-gray-700"
          >
            顾客视图
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
