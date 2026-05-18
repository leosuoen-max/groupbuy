import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RecurringDeliverySlotChooser } from '../components/customer/RecurringDeliverySlotChooser';
import { FeituanFlowHeader } from '../components/feituan/FeituanFlowHeader';
import { FeituanTransferPaymentBlock } from '../components/feituan/FeituanTransferPaymentBlock';
import { FeituanWalletPaymentBlock } from '../components/feituan/FeituanWalletPaymentBlock';
import { useAuthUser } from '../hooks/useAuthUser';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import {
  formatDeliverySlotLabel,
  formatOrderDeliveryTimeDisplay,
  type ProjectDeliverySlot,
} from '../lib/deliverySlot';
import { formatMYR } from '../lib/formatMYR';
import { FEITUAN_TW } from '../lib/feituanHomeTheme';
import { hasOrderDeliverySlotLocked } from '../lib/orderDeliverySlot';
import { buildPaymentGroups } from '../lib/paymentGroups';
import { sumGroupAmountByStatus } from '../lib/paymentGroupView';
import {
  applyFeituanWalletPaymentToPaymentRef,
  getFeituanWalletSettings,
  planFeituanWalletPaymentForPaymentRef,
  type FeituanWalletCartPaymentPlan,
} from '../lib/feituanWalletService';
import {
  customerUpdateOrderPreferredDeliverySlot,
  customerUploadPaymentScreenshotForPaymentRef,
  listOrdersByPaymentRef,
  type OrderRow,
} from '../lib/orderService';
import { getProject } from '../lib/projectService';
import {
  estimateSlotIfPaidNow,
  isProjectRecurring,
} from '../lib/recurringDeliverySchedule';
import type { ProjectDoc } from '../types/firestore';

function resolveRecurringPreferredSlot(
  order: OrderRow['data'],
  project: ProjectDoc
): ProjectDeliverySlot | null {
  const pref = order.preferredDeliverySlot;
  if (pref?.date && pref?.period) {
    return { date: pref.date, period: pref.period };
  }
  return estimateSlotIfPaidNow(project);
}

function recurringDeliveryDisplayLabel(
  slot: ProjectDeliverySlot | null,
  project: ProjectDoc
): string {
  const resolved = slot ?? estimateSlotIfPaidNow(project);
  if (!resolved) return '—';
  return formatDeliverySlotLabel(resolved.date, resolved.period);
}

export default function FeituanCartPayment() {
  const { paymentRef = '' } = useParams<{ paymentRef: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const customerKey = getOrCreateCustomerKey();
  const fileRef = useRef<HTMLInputElement>(null);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, ProjectDoc>>({});
  const [slotSavingOrderId, setSlotSavingOrderId] = useState<string | null>(null);
  const [slotErrByOrderId, setSlotErrByOrderId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [walletPlan, setWalletPlan] = useState<FeituanWalletCartPaymentPlan | null>(null);
  const [walletPaying, setWalletPaying] = useState(false);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<
    { id: string; name: string; qrCodeUrl: string }[]
  >([]);

  const reload = useCallback(async () => {
    if (!paymentRef.trim()) {
      setErr('缺少付款批次号');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listOrdersByPaymentRef({
        paymentRef: decodeURIComponent(paymentRef),
        customerKey,
      });
      setOrders(rows);
      const projectIds = [...new Set(rows.map((r) => r.data.projectId))];
      const projectMap: Record<string, ProjectDoc> = {};
      await Promise.all(
        projectIds.map(async (id) => {
          const row = await getProject(id);
          if (row) projectMap[id] = row.data;
        })
      );
      setProjectsById(projectMap);
      if (!rows.length) setErr('找不到该批次的订单');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [customerKey, paymentRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void getFeituanWalletSettings().then((s) => {
      setPaymentMethods(
        (s?.paymentMethods ?? []).filter((m) => m.qrCodeUrl?.trim())
      );
    });
  }, []);

  const totalUnpaid = useMemo(() => {
    let sum = 0;
    for (const row of orders) {
      sum += sumGroupAmountByStatus(buildPaymentGroups(row.data), 'unpaid');
    }
    return sum;
  }, [orders]);

  const tightestPromoDue = useMemo(() => {
    let min: number | null = null;
    for (const row of orders) {
      const due = row.data.timedPromoPaymentDueAt?.toMillis?.();
      if (due == null) continue;
      if (min == null || due < min) min = due;
    }
    if (min == null) return null;
    return new Date(min);
  }, [orders]);

  const allConfirmed = useMemo(
    () =>
      orders.length > 0 &&
      orders.every((r) => {
        const g = buildPaymentGroups(r.data);
        return sumGroupAmountByStatus(g, 'unpaid') <= 0.0001;
      }),
    [orders]
  );

  useEffect(() => {
    if (!user?.uid || authLoading || !orders.length) {
      setWalletPlan(null);
      return;
    }
    let cancelled = false;
    void planFeituanWalletPaymentForPaymentRef(
      orders.map((r) => r.data),
      user.uid
    ).then((plan) => {
      if (!cancelled) setWalletPlan(plan);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, orders, user?.uid]);

  const handleWalletPay = async () => {
    if (!user?.uid || walletPaying) return;
    setWalletMsg(null);
    setWalletPaying(true);
    try {
      const result = await applyFeituanWalletPaymentToPaymentRef({
        paymentRef: decodeURIComponent(paymentRef),
        userId: user.uid,
        customerKey,
        orderIds: orders.map((r) => r.id),
      });
      setWalletMsg(`饭团钱包已抵扣 ${formatMYR(result.deducted)}`);
      await reload();
      window.setTimeout(() => navigate('/feituan/my-orders', { replace: true }), 800);
    } catch (e) {
      setWalletMsg(e instanceof Error ? e.message : '钱包支付失败');
    } finally {
      setWalletPaying(false);
    }
  };

  const handlePreferredSlotChange = async (
    orderRow: OrderRow,
    slot: ProjectDeliverySlot
  ) => {
    setSlotErrByOrderId((prev) => {
      const next = { ...prev };
      delete next[orderRow.id];
      return next;
    });
    setSlotSavingOrderId(orderRow.id);
    try {
      await customerUpdateOrderPreferredDeliverySlot({
        orderFirestoreId: orderRow.id,
        projectId: orderRow.data.projectId,
        orderNumber: orderRow.data.orderNumber,
        customerKey,
        targetDate: slot.date,
        targetPeriod: slot.period,
      });
      await reload();
    } catch (e) {
      setSlotErrByOrderId((prev) => ({
        ...prev,
        [orderRow.id]: e instanceof Error ? e.message : '保存失败',
      }));
    } finally {
      setSlotSavingOrderId(null);
    }
  };

  const handleUpload = async (file: File) => {
    const first = orders[0];
    if (!first) return;
    setUploadErr(null);
    setUploading(true);
    try {
      await customerUploadPaymentScreenshotForPaymentRef({
        paymentRef: decodeURIComponent(paymentRef),
        customerKey,
        orderFirestoreId: first.id,
        projectId: first.data.projectId,
        orderNumber: first.data.orderNumber,
        file,
      });
      await reload();
      window.setTimeout(() => navigate('/feituan/my-orders', { replace: true }), 800);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-gray-600">
        加载付款信息…
      </div>
    );
  }

  if (err && !orders.length) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 text-sm">
        <p className="text-red-600">{err}</p>
        <Link to="/feituan/cart" className="mt-4 inline-block text-emerald-700">
          返回购物车
        </Link>
      </div>
    );
  }

  const paymentPath = `/feituan/cart-payment/${encodeURIComponent(decodeURIComponent(paymentRef))}`;

  return (
    <div className={`${FEITUAN_TW.flowPage} pb-12`}>
      <FeituanFlowHeader
        backTo="/feituan/cart"
        backLabel="购物车"
        title="合并付款"
        subtitle={`共 ${orders.length} 笔订单`}
      />

      <main className={FEITUAN_TW.flowMain}>
        {allConfirmed ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
            本批订单已付清。
            <Link to="/feituan/my-orders" className="ml-2 font-semibold underline">
              查看我的订单
            </Link>
          </p>
        ) : null}

        <section className={`rounded-xl border p-3 ${FEITUAN_TW.panelHeader}`}>
          <p className="text-xs text-gray-600">应付合计</p>
          <p className="text-2xl font-bold tabular-nums">{formatMYR(totalUnpaid)}</p>
          {tightestPromoDue ? (
            <p className="mt-1 text-xs text-amber-800">
              含限时优惠，请尽快付款（最紧截止{' '}
              {tightestPromoDue.toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
              ）
            </p>
          ) : null}
        </section>

        <section className={`rounded-xl border p-3 ${FEITUAN_TW.panelHeader}`}>
          <h2 className={`mb-2 text-sm font-semibold ${FEITUAN_TW.text}`}>订单明细</h2>
          <ul className="space-y-3">
            {orders.map((row) => {
              const project = projectsById[row.data.projectId];
              const recurring = project ? isProjectRecurring(project) : false;
              const slotLocked = hasOrderDeliverySlotLocked(row.data);
              const unpaid =
                sumGroupAmountByStatus(buildPaymentGroups(row.data), 'unpaid') >
                0.0001;
              const showRecurringChooser =
                recurring && !slotLocked && unpaid && !allConfirmed;
              const preferredSlot = project
                ? resolveRecurringPreferredSlot(row.data, project)
                : null;

              return (
                <li
                  key={row.id}
                  className="border-b border-gray-50 pb-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{row.data.projectTitle}</p>
                      <p className="text-xs text-gray-500">
                        #{row.data.orderNumber}
                      </p>
                      {showRecurringChooser && project ? (
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-gray-700">
                          <span className="font-medium text-gray-800">
                            预计配送：
                          </span>
                          <span className="font-semibold text-emerald-800">
                            {recurringDeliveryDisplayLabel(
                              preferredSlot,
                              project
                            )}
                          </span>
                          <span className="text-gray-500">
                            （按付款时间确认）
                          </span>
                          <RecurringDeliverySlotChooser
                            project={project}
                            mode="checkout"
                            value={preferredSlot}
                            onChange={(slot) => {
                              void handlePreferredSlotChange(row, slot);
                            }}
                            saving={slotSavingOrderId === row.id}
                            message={slotErrByOrderId[row.id] ?? null}
                          />
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-gray-500">
                          配送{' '}
                          {formatOrderDeliveryTimeDisplay(row.data, project ?? null)}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 tabular-nums font-medium">
                      {formatMYR(row.data.pendingAmount ?? row.data.totalAmount)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {!allConfirmed ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = '';
              }}
            />
            <FeituanWalletPaymentBlock
              authLoading={authLoading}
              hasPhone={Boolean(user?.phoneNumber)}
              plan={walletPlan}
              paying={walletPaying}
              message={walletMsg}
              onPay={() => void handleWalletPay()}
              accountReturnTo={paymentPath}
              payButtonLabel="饭团钱包一键付清"
            />
            <FeituanTransferPaymentBlock
              methods={paymentMethods}
              uploading={uploading}
              uploadErr={uploadErr}
              onPickFile={() => fileRef.current?.click()}
              hint="余额不足时可转账后上传一张截图，将同步到本批所有订单。"
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
