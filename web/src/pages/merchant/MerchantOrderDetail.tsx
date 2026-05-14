import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { PaymentScreenshotsPanel } from '../../components/merchant/PaymentScreenshotsPanel';
import { ActionButton } from '../../components/ui/ActionButton';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import { deriveDisplayOrderStatus } from '../../lib/paymentGroupView';
import {
  getOrderByNumber,
  merchantAppendInternalNote,
  merchantAssignManualDeliveryMatch,
  merchantConfirmPaymentGroup,
  merchantWaiveInitialPaymentScreenshot,
  merchantWaiveAppendBatchScreenshot,
  type OrderRow,
} from '../../lib/orderService';
import { isFeituanAdmin } from '../../lib/feituanService';
import {
  listDeliveryPointsByOwnerId,
  type DeliveryPointRow,
} from '../../lib/deliveryPointService';
import { getShopBySlug } from '../../lib/shopService';
import {
  cardApplicationsForPaymentGroup,
  listOrderCardPaymentApplications,
} from '../../lib/orderCardPaymentApplications';
import {
  feituanWalletApplicationsForPaymentGroup,
  listOrderFeituanWalletPaymentApplications,
} from '../../lib/orderFeituanWalletApplications';
import { buildPaymentGroups, type PaymentGroup } from '../../lib/paymentGroups';
import type {
  OrderCardPaymentDoc,
  OrderFeituanWalletPaymentDoc,
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

const paymentGroupStatusLabel: Record<PaymentGroup['status'], string> = {
  unpaid: '待付款',
  pending: '待确认',
  confirmed: '已确认',
};

function paymentGroupBadgeClass(status: PaymentGroup['status']): string {
  if (status === 'confirmed') return 'bg-emerald-100 text-emerald-900';
  if (status === 'pending') return 'bg-sky-100 text-sky-950';
  return 'bg-amber-100 text-amber-950';
}

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

function FeituanWalletPaymentBreakdown({
  payment,
  title = '本组为饭团钱包自动确认（无需截图）',
}: {
  payment: OrderFeituanWalletPaymentDoc;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">钱包抵扣 {formatMYR(payment.deduct)}</p>
      <p className="mt-0.5 text-orange-800">
        钱包 #{payment.walletId.slice(0, 6)} · 用户 {payment.userId.slice(0, 8)}…
      </p>
      <p className="mt-0.5 text-orange-800">
        时间：{payment.appliedAt?.toDate?.().toLocaleString() ?? '—'}
      </p>
    </div>
  );
}

export default function MerchantOrderDetail({
  mode = 'merchant',
}: {
  mode?: 'merchant' | 'feituanAdmin';
}) {
  const { shopSlug = '', projectId = '', orderNumber = '' } = useParams<{
    shopSlug?: string;
    projectId: string;
    orderNumber: string;
  }>();
  const isFeituanAdminMode = mode === 'feituanAdmin';
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
    | 'note'
    | 'waive_append_proof'
    | 'waive_initial_proof'
    | null
  >(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [dpModalOpen, setDpModalOpen] = useState(false);
  const [dpModalLoading, setDpModalLoading] = useState(false);
  const [dpModalSubmitting, setDpModalSubmitting] = useState(false);
  const [dpModalErr, setDpModalErr] = useState<string | null>(null);
  const [deliveryPointRows, setDeliveryPointRows] = useState<DeliveryPointRow[]>(
    []
  );
  /** 选中的配送点 id；特殊值 __nomatch__ 表示匹配不成功 */
  const [dpPick, setDpPick] = useState<string>('');

  const refresh = useCallback(async () => {
    if (isFeituanAdminMode && !user) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getOrderByNumber(pid, onum);
      if (!r) {
        setRow(null);
        setErr('订单不存在');
        return;
      }
      if (isFeituanAdminMode) {
        if (r.data.channel !== 'feituan') {
          setRow(null);
          setErr('该订单不是饭团订单');
          return;
        }
        if (!user || !(await isFeituanAdmin(user.uid))) {
          setRow(null);
          setErr('无权限访问饭团订单');
          return;
        }
      } else if (r.data.shopSlug !== slug) {
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
  }, [isFeituanAdminMode, onum, pid, slug, user]);

  useEffect(() => {
    queueMicrotask(() => {
      if (authLoading) return;
      if (!user) {
        setLoading(false);
        return;
      }
      void refresh();
    });
  }, [authLoading, refresh, user]);

  useEffect(() => {
    if (!dpModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDpModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dpModalOpen]);

  useEffect(() => {
    if (!dpModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [dpModalOpen]);

  const openDeliveryPointModal = useCallback(async () => {
    setDpModalErr(null);
    setDpPick('');
    setDpModalOpen(true);
    setDpModalLoading(true);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setDpModalErr('未找到店铺');
        setDeliveryPointRows([]);
        return;
      }
      const rows = await listDeliveryPointsByOwnerId(shop.data.ownerId, {
        fallbackShopId: shop.id,
        includeInactive: true,
      });
      setDeliveryPointRows(rows);
    } catch (e) {
      setDpModalErr(e instanceof Error ? e.message : '加载配送点失败');
      setDeliveryPointRows([]);
    } finally {
      setDpModalLoading(false);
    }
  }, [slug]);

  const submitDeliveryPointPick = async () => {
    if (!user || !row) return;
    if (!dpPick) {
      setDpModalErr('请选择配送点或「匹配不成功」');
      return;
    }
    setDpModalErr(null);
    setDpModalSubmitting(true);
    try {
      const dpId = dpPick === '__nomatch__' ? null : dpPick;
      await merchantAssignManualDeliveryMatch({
        orderFirestoreId: row.id,
        actorUserId: user.uid,
        deliveryPointId: dpId,
      });
      setMsg(
        dpId
          ? '已关联配送点'
          : '已记录为按原地址配送（未关联配送点）'
      );
      setDpModalOpen(false);
      await refresh();
    } catch (e) {
      setDpModalErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setDpModalSubmitting(false);
    }
  };

  const handleConfirmPaymentGroup = async (paymentGroupId: string) => {
    if (!user || !row) return;
    setBusy('confirm');
    setMsg(null);
    try {
      await merchantConfirmPaymentGroup(row.id, paymentGroupId, user.uid);
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

  const baseOrders = isFeituanAdminMode
    ? '/admin/feituan/orders'
    : `/dashboard/${encodeURIComponent(slug)}/orders`;
  const customerUrl = isFeituanAdminMode
    ? `/feituan/projects/${encodeURIComponent(pid)}/orders/${encodeURIComponent(onum)}`
    : `/shop/${encodeURIComponent(slug)}/${encodeURIComponent(pid)}/orders/${encodeURIComponent(onum)}`;

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
  const isFeituanOrder = order.channel === 'feituan';
  const canMerchantManagePayment = !isFeituanOrder || isFeituanAdminMode;
  const displayStatus = deriveDisplayOrderStatus(order);
  const created = order.createdAt?.toDate?.() ?? new Date();
  const timeStr = `${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;

  const appendBatches = order.appendBatches ?? [];
  const legacyNoSplit =
    appendBatches.length > 0 && !(order.initialLines?.length ?? 0);

  const cardAppsAll = listOrderCardPaymentApplications(order);
  const feituanWalletAppsAll = listOrderFeituanWalletPaymentApplications(order);
  const canonicalPaymentGroups = buildPaymentGroups(order);
  const pendingHasUnpaidGroup = canonicalPaymentGroups.some((g) => g.status === 'unpaid');
  const canonicalPaymentSection = (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">
        支付组（按支付动作顺序固定编号）
      </h2>
      {canonicalPaymentGroups.map((group, index) => {
        const cardApps = cardApplicationsForPaymentGroup(order, group);
        const walletApps = feituanWalletApplicationsForPaymentGroup(order, group);
        const groupNumber = index + 1;
        const canConfirmGroup =
          canMerchantManagePayment &&
          group.status === 'pending' &&
          order.status !== 'cancelled';
        const canWaiveInitial =
          canMerchantManagePayment &&
          group.status === 'unpaid' &&
          group.includesInitial &&
          group.appendBatchIds.length === 0 &&
          order.status !== 'cancelled';
        const canWaiveSingleAppend =
          canMerchantManagePayment &&
          group.status === 'unpaid' &&
          !group.includesInitial &&
          group.appendBatchIds.length === 1 &&
          order.status !== 'cancelled';
        const groupTime =
          group.timeMs > 0 ? new Date(group.timeMs).toLocaleString() : '—';
        return (
          <div
            key={group.id}
            className="rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                支付组 {groupNumber}
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${paymentGroupBadgeClass(group.status)}`}
              >
                {paymentGroupStatusLabel[group.status]}
              </span>
            </div>
            <p className="mb-2 text-xs text-gray-500">时间：{groupTime}</p>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
              {aggregateOrderLines(group.lines).map((line, lineIndex) => (
                <li
                  key={`${group.id}-${line.productId}-${lineIndex}`}
                  className="flex justify-between gap-2 px-3 py-2"
                >
                  <span>
                    {line.name}
                    {linePromoTag(line)} ×{line.quantity}
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatMYR(line.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
              <span>本组小计</span>
              <span>{formatMYR(group.subtotal)}</span>
            </div>
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-semibold text-gray-700">付款凭证</h3>
              {group.proofs.length > 0 ? (
                <PaymentScreenshotsPanel
                  paymentScreenshots={group.proofs}
                  emptyHint="暂无本组截图。"
                />
              ) : cardApps.length > 0 ? (
                <div className="space-y-2">
                  {cardApps.map((cp, appIndex) => (
                    <CardPaymentBreakdown
                      key={`${cp.appliedAt?.toMillis?.() ?? 0}-${appIndex}`}
                      cardPayment={cp}
                      lines={group.lines}
                      title={
                        cardApps.length > 1
                          ? `本组卡支付自动确认（第 ${appIndex + 1} 笔）`
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : walletApps.length > 0 ? (
                <div className="space-y-2">
                  {walletApps.map((payment, appIndex) => (
                    <FeituanWalletPaymentBreakdown
                      key={`${payment.appliedAt?.toMillis?.() ?? 0}-${appIndex}`}
                      payment={payment}
                      title={
                        walletApps.length > 1
                          ? `本组饭团钱包自动确认（第 ${appIndex + 1} 笔）`
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-3 py-3 text-sm text-amber-950">
                  <p className="font-semibold">暂无对应付款截图</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-900">
                    {group.status === 'unpaid'
                      ? '该支付组尚未上传对应付款截图。'
                      : '该支付组暂无可展示的付款凭证。'}
                  </p>
                </div>
              )}
            </div>
            {canConfirmGroup ? (
              <ActionButton
                type="button"
                variant="primary"
                fullWidth
                disabled={busy !== null}
                className="mt-3 h-11"
                onClick={() => void handleConfirmPaymentGroup(group.id)}
              >
                {busy === 'confirm'
                  ? '处理中…'
                  : `确认本组收款（${formatMYR(group.subtotal)}）`}
              </ActionButton>
            ) : null}
            {canWaiveInitial || canWaiveSingleAppend ? (
              <ActionButton
                type="button"
                variant="secondary"
                fullWidth
                disabled={busy !== null}
                className="mt-3 h-11"
                onClick={() =>
                  canWaiveInitial
                    ? void handleWaiveInitialProof()
                    : void handleWaiveAppendProof(group.appendBatchIds[0]!)
                }
              >
                {busy === 'waive_initial_proof' || busy === 'waive_append_proof'
                  ? '处理中…'
                  : `本组免提交付款凭证（${formatMYR(group.subtotal)}）`}
              </ActionButton>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <PageShell title={`订单 #${order.orderNumber}`} subtitle={order.projectTitle}>
      {msg ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}
      {busy === 'confirm' ? (
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          正在向服务器写入确认结果，弱网下可能需要十余秒，请勿关闭页面或重复点击。
        </p>
      ) : null}

      <div className="space-y-4 text-sm text-gray-800">
        {isFeituanOrder && !isFeituanAdminMode ? (
          <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-950">
            饭团订单：店家后台仅用于查看生产与配送信息，收款确认请到「饭团订单」由饭团管理员处理。
          </p>
        ) : null}
        {isFeituanAdminMode ? (
          <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-950">
            饭团订单详情：本页沿用商户订单支付组界面，由饭团管理员按支付组确认收款。
          </p>
        ) : null}

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
          {order.status === 'partial_paid' && pendingHasUnpaidGroup ? (
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

        {canonicalPaymentSection}
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
          {feituanWalletAppsAll.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
              <p className="font-semibold">饭团钱包抵扣记录</p>
              {feituanWalletAppsAll.map((payment, i) => (
                <div
                  key={`sum-feituan-wallet-${i}-${payment.appliedAt?.toMillis?.() ?? 0}`}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <span>
                    第 {i + 1} 笔 · {payment.appliedAt?.toDate?.().toLocaleString() ?? '—'}
                  </span>
                  <span className="font-semibold">{formatMYR(payment.deduct)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">配送</h2>
            {order.isManualMatch ? (
              <button
                type="button"
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100"
                onClick={() => void openDeliveryPointModal()}
              >
                配送点
              </button>
            ) : null}
          </div>
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

        {dpModalOpen ? (
          <div
            className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-dp-match-title"
            onClick={() => !dpModalSubmitting && setDpModalOpen(false)}
          >
            <div
              className="max-h-[min(88vh,620px)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-2xl sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                <h3
                  id="order-dp-match-title"
                  className="text-base font-semibold text-gray-900"
                >
                  关联配送点
                </h3>
                <button
                  type="button"
                  className="inline-flex h-9 min-w-[2.25rem] shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
                  aria-label="关闭"
                  disabled={dpModalSubmitting}
                  onClick={() => setDpModalOpen(false)}
                >
                  <span className="text-xl leading-none" aria-hidden>
                    ×
                  </span>
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-800">
                <p className="text-xs font-medium text-gray-500">顾客地址</p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {order.customerAddress?.trim() || '—'}
                </p>
              </div>

              {dpModalErr ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {dpModalErr}
                </p>
              ) : null}

              {dpModalLoading ? (
                <p className="mt-4 text-sm text-gray-600">加载配送点…</p>
              ) : (
                <fieldset className="mt-4 space-y-2 border-0 p-0">
                  <legend className="sr-only">选择配送点</legend>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm hover:bg-gray-50">
                    <input
                      type="radio"
                      name="dp-pick"
                      className="mt-1"
                      checked={dpPick === '__nomatch__'}
                      onChange={() => setDpPick('__nomatch__')}
                      disabled={dpModalSubmitting}
                    />
                    <span>
                      <span className="font-medium text-gray-900">
                        匹配不成功，按原地址配送
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-600">
                        不修改顾客地址，仅在订单上留痕
                      </span>
                    </span>
                  </label>
                  {deliveryPointRows.map((p) => {
                    const inactive = p.data.isActive === false;
                    const code = (p.data.code ?? '').trim();
                    const label =
                      (p.data.shortName ?? p.data.name ?? '').trim() || p.id;
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm hover:bg-gray-50"
                      >
                        <input
                          type="radio"
                          name="dp-pick"
                          className="mt-1"
                          checked={dpPick === p.id}
                          onChange={() => setDpPick(p.id)}
                          disabled={dpModalSubmitting}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-gray-900">
                            {code ? `[${code}] ${label}` : label}
                            {inactive ? (
                              <span className="ml-1 text-xs font-normal text-amber-800">
                                （已停用）
                              </span>
                            ) : null}
                          </span>
                          {p.data.detailAddress?.trim() ? (
                            <span className="mt-0.5 block text-xs text-gray-600">
                              {p.data.detailAddress.trim()}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              )}

              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="inline-flex h-11 flex-1 min-w-[8rem] items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
                  disabled={
                    dpModalSubmitting || dpModalLoading || !dpPick
                  }
                  onClick={() => void submitDeliveryPointPick()}
                >
                  {dpModalSubmitting ? '提交中…' : '确定'}
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800 disabled:opacity-50"
                  disabled={dpModalSubmitting}
                  onClick={() => setDpModalOpen(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
