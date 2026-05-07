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

/** 已入账的历史加购（商户曾逐笔确认过的批次） */
function CardPaymentBreakdown({
  cardPayment,
  lines,
}: {
  cardPayment: OrderCardPaymentDoc;
  lines: OrderLineDoc[];
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <p className="font-semibold">本组为卡支付自动确认（无需截图）</p>
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
  batch,
  paymentScreenshots,
  cardPayment,
  orderLines,
}: {
  batch: OrderAppendBatchDoc;
  paymentScreenshots: unknown;
  cardPayment?: OrderCardPaymentDoc;
  orderLines: OrderLineDoc[];
}) {
  const hasBatchProof = hasPaymentScreenshotForAppendBatch(paymentScreenshots, batch.id);
  const isCardAutoConfirmed = batch.confirmedByUserId === 'customer_card_auto';
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">加购（已核实）</h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
          补款已入账
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-600">时间：{batchTimeStr(batch)}</p>
      {batch.confirmedAt ? (
        <p className="mb-2 text-xs text-emerald-800">
          商户已于 {batch.confirmedAt.toDate().toLocaleString()} 确认收款
        </p>
      ) : null}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
        {batch.lines.map((l, idx) => (
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
        {isCardAutoConfirmed && !hasBatchProof && cardPayment ? (
          <CardPaymentBreakdown cardPayment={cardPayment} lines={orderLines} />
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

  const handleConfirmAll = async () => {
    if (!user || !row) return;
    setBusy('confirm_all');
    setMsg(null);
    try {
      await merchantConfirmPendingAppendBatches(row.id, user.uid);
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
      setMsg('已确认首单收款');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleConfirmAppendBatch = async (appendBatchId: string) => {
    if (!user || !row) return;
    setBusy('confirm_append_single');
    setMsg(null);
    try {
      await merchantConfirmAppendBatch(row.id, appendBatchId, user.uid);
      setMsg('已确认该组加购补款');
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
      setMsg('首单已设为免提交付款凭证，现可进行确认');
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

  const firstPaymentAcknowledged =
    !!order.initialPaymentConfirmedAt ||
    (initialTotal > 0 &&
      Number(order.paidAmount) + 0.001 >= initialTotal &&
      (order.status === 'confirmed' || order.status === 'partial_paid'));

  const confirmedBatches = appendBatches
    .filter((b) => b.confirmedAt)
    .sort(
      (a, b) =>
        (a.appendedAt?.toMillis?.() ?? 0) -
        (b.appendedAt?.toMillis?.() ?? 0)
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

  // 同一次支付动作覆盖全部待付（首单+所有加购）时，只需一次确认
  const canConfirmAllInOneAction =
    !firstPaymentAcknowledged &&
    firstGroupHasProof &&
    pendingBatches.length > 0 &&
    pendingBatchGroups.every((g) => g.canConfirm) &&
    (order.status === 'unpaid' || order.status === 'pending' || order.status === 'partial_paid');

  const allPendingTotal =
    (canConfirmAllInOneAction
      ? initialTotal + pendingBatches.reduce((s, b) => s + (Number(b.deltaAmount) || 0), 0)
      : 0);

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

  const pendingSection = pendingBatchGroups.length > 0 ? (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-amber-950">
        待确认加购（按提交凭证行为分组；每组独立确认）
      </h2>
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        {pendingBatchGroups.map(({ batch, canConfirm, includeUntagged }) => (
          <div
            key={batch.id}
            className="rounded-xl border border-amber-100 bg-white px-3 py-3"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">加购组</h3>
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
              {batch.lines.map((l, idx) => (
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
              <span>加购小计</span>
              <span>{formatMYR(batch.deltaAmount)}</span>
            </div>
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-semibold text-gray-700">付款凭证</h3>
              <PaymentScreenshotsPanel
                paymentScreenshots={order.paymentScreenshots}
                appendBatchIdFilter={batch.id}
                includeUntagged={includeUntagged}
                untaggedNotBeforeMillis={batch.appendedAt.toMillis()}
                emptyHint="该组尚未上传对应补款截图。"
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
                  onClick={() => void handleConfirmAppendBatch(batch.id)}
                >
                  {busy === 'confirm_append_single'
                    ? '处理中…'
                    : `确认本组补款（${formatMYR(batch.deltaAmount)}）`}
                </ActionButton>
                {!canConfirm ? (
                  <p className="mt-2 text-xs text-amber-950">
                    顾客尚未上传该组有效补款截图，请先让顾客在订单页上传。
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-xs text-gray-600">
                当前状态不可确认该组补款。
              </p>
            )}
          </div>
        ))}
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

      <div className="space-y-4 text-sm text-gray-800">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-bold">#{order.orderNumber}</div>
            <StatusChip
              tone={toChipTone(order.status)}
              label={statusLabel[order.status] ?? order.status}
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
              当前加购补款尚未收到有效付款截图，视同 <strong>待付款</strong>
              ：请先让顾客在手机端上传补款截图后再确认。
            </p>
          ) : null}
        </div>

        {legacyNoSplit ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            此单为历史数据，首单与加购未拆分快照；下方「加购」仍以批次为准核对补款。
          </p>
        ) : null}

        {/* ── 合并确认区块：同一次支付动作覆盖首单+所有加购时，一次确认 ── */}
        {canConfirmAllInOneAction ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-sky-950">
                本次付款明细（首单 + 加购合计）
              </h2>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
                已传图 · 待确认
              </span>
            </div>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
              {initialLines.map((l, idx) => (
                <li
                  key={`init-${l.productId}-${idx}`}
                  className="flex justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {l.name}
                    {linePromoTag(l)} ×{l.quantity}
                  </span>
                  <span className="tabular-nums font-medium">{formatMYR(l.subtotal)}</span>
                </li>
              ))}
              {pendingBatches.map((b) =>
                b.lines.map((l, idx) => (
                  <li
                    key={`${b.id}-${l.productId}-${idx}`}
                    className="flex justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>
                      {l.name}
                      {linePromoTag(l)} ×{l.quantity}
                    </span>
                    <span className="tabular-nums font-medium">{formatMYR(l.subtotal)}</span>
                  </li>
                ))
              )}
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
              onClick={() => void handleConfirmAll()}
            >
              {busy === 'confirm_all'
                ? '处理中…'
                : `确认全部收款（${formatMYR(allPendingTotal)}）`}
            </ActionButton>
            <p className="mt-2 text-xs text-gray-600">
              本次付款一张凭证覆盖首单与加购，点击后一次性确认全部。
            </p>
          </div>
        ) : (
          <>
            {showPendingBeforeFirst ? pendingSection : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">首单（下单时的金额）</h2>
                {firstPaymentAcknowledged ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                    已确认收款
                  </span>
                ) : order.status === 'pending' ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
                    已传图 · 待确认
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
                    待付款（未传图）
                  </span>
                )}
              </div>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                {initialLines.map((l, idx) => (
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
                <span>首单小计</span>
                <span>{formatMYR(initialTotal)}</span>
              </div>
              <div className="mt-3">
                <h3 className="mb-1 text-xs font-semibold text-gray-700">
                  首单相关截图（未挂加购批次的图）
                </h3>
                {order.cardPayment && firstPaymentAcknowledged && !firstGroupHasProof ? (
                  <CardPaymentBreakdown cardPayment={order.cardPayment} lines={initialLines} />
                ) : (
                  <PaymentScreenshotsPanel
                    paymentScreenshots={order.paymentScreenshots}
                    appendBatchIdFilter={null}
                    emptyHint="暂无首单截图。"
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
                    本组对应顾客首笔付款提交（可多张凭证）。确认后若仍有未确认加购，会自动保留待收部分到后续组。
                  </p>
                </>
              ) : order.status === 'confirmed' ? (
                <p className="mt-2 text-xs text-gray-600">本组已完成确认。</p>
              ) : null}
            </div>

            {!showPendingBeforeFirst ? pendingSection : null}
          </>
        )}

        {confirmedBatches.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">已核实加购（补款已入账）</h2>
            {confirmedBatches.map((b) => (
              <ConfirmedAppendBatchCard
                key={b.id}
                batch={b}
                paymentScreenshots={order.paymentScreenshots}
                cardPayment={order.cardPayment}
                orderLines={order.lines}
              />
            ))}
          </div>
        ) : (
          <EmptyStateCard title="暂无已确认的加购记录" className="py-4" />
        )}

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">订单当前合计</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {order.lines.map((l, idx) => (
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
          {order.cardPayment ? (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <p className="font-semibold">卡支付（系统已抵扣）</p>
              <ul className="mt-1 space-y-0.5">
                {order.cardPayment.passCards.map((c) => (
                  <li key={c.customerCardId}>
                    · 次卡 #{c.customerCardId.slice(0, 6)} — 抵扣 {c.uses} 次（
                    {c.appliedLineProductIds
                      .map((pid) =>
                        order.lines.find((l) => l.productId === pid)?.name ?? '行'
                      )
                      .join('、')}
                    ）
                  </li>
                ))}
                {order.cardPayment.wallet ? (
                  <li>
                    · 钱包扣减 RM{' '}
                    {Number(order.cardPayment.wallet.deduct ?? 0).toFixed(2)}
                  </li>
                ) : null}
                <li className="pt-1 font-semibold">
                  共抵扣 RM{' '}
                  {Number(order.cardPayment.totalDeducted ?? 0).toFixed(2)}
                </li>
              </ul>
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
