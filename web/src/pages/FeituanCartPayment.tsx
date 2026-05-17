import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { formatMYR } from '../lib/formatMYR';
import { FEITUAN_HOME, FEITUAN_TW } from '../lib/feituanHomeTheme';
import { buildPaymentGroups } from '../lib/paymentGroups';
import { sumGroupAmountByStatus } from '../lib/paymentGroupView';
import {
  applyFeituanWalletPaymentToPaymentRef,
  getFeituanWalletSettings,
  planFeituanWalletPaymentForPaymentRef,
  type FeituanWalletCartPaymentPlan,
} from '../lib/feituanWalletService';
import {
  customerUploadPaymentScreenshotForPaymentRef,
  listOrdersByPaymentRef,
  type OrderRow,
} from '../lib/orderService';
import { formatOrderDeliverySlotLabel } from '../lib/deliverySlot';

export default function FeituanCartPayment() {
  const { paymentRef = '' } = useParams<{ paymentRef: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const customerKey = getOrCreateCustomerKey();
  const fileRef = useRef<HTMLInputElement>(null);

  const [orders, setOrders] = useState<OrderRow[]>([]);
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

  const primaryQr = paymentMethods[0];

  return (
    <div className="min-h-svh bg-[#f6f7f8] pb-12">
      <header className="border-b bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">合并付款</h1>
        <p className="text-xs text-gray-500">共 {orders.length} 笔订单</p>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-4 text-sm">
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

        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <h2 className="mb-2 font-semibold">订单明细</h2>
          <ul className="space-y-2">
            {orders.map((row) => (
              <li key={row.id} className="border-b border-gray-50 pb-2 last:border-0">
                <p className="font-medium">{row.data.projectTitle}</p>
                <p className="text-xs text-gray-500">
                  #{row.data.orderNumber} · 配送 {formatOrderDeliverySlotLabel(row.data)}
                </p>
                <p className="text-right tabular-nums">
                  {formatMYR(row.data.pendingAmount ?? row.data.totalAmount)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {!allConfirmed ? (
          <>
            <section className={`rounded-xl border p-3 ${FEITUAN_TW.panelLoose}`}>
              <h2 className="mb-2 font-semibold">饭团钱包</h2>
              {!user?.phoneNumber ? (
                <p className="text-xs text-amber-800">
                  请先在
                  <Link to="/feituan/account" className="mx-1 underline">
                    账号中心
                  </Link>
                  绑定手机号
                </p>
              ) : walletPlan && !walletPlan.ok ? (
                <p className="text-xs text-amber-800">{walletPlan.message}</p>
              ) : walletPlan?.ok ? (
                <p className="text-xs text-gray-600">
                  余额 {formatMYR(walletPlan.balance)} · 本批需付{' '}
                  {formatMYR(walletPlan.payAmount)}
                </p>
              ) : null}
              <button
                type="button"
                disabled={
                  walletPaying ||
                  !walletPlan?.ok ||
                  !user?.phoneNumber
                }
                className="mt-3 h-11 w-full rounded-xl text-sm font-semibold text-white disabled:bg-gray-300"
                style={{ backgroundColor: FEITUAN_HOME.primary }}
                onClick={() => void handleWalletPay()}
              >
                {walletPaying ? '支付中…' : '饭团钱包一键付清'}
              </button>
              {walletPlan && !walletPlan.ok && walletPlan.reason === 'insufficient' ? (
                <Link
                  to="/feituan/wallet/topup"
                  className="mt-2 block text-center text-sm font-medium text-emerald-700 underline"
                >
                  去充值
                </Link>
              ) : null}
              {walletMsg ? <p className="mt-2 text-xs">{walletMsg}</p> : null}
            </section>

            <section className="rounded-xl border border-gray-100 bg-white p-3">
              <h2 className="mb-2 font-semibold">转账付款</h2>
              <p className="mb-2 text-xs text-gray-600">
                余额不足时可转账后上传一张截图，将同步到本批所有订单。
              </p>
              {primaryQr ? (
                <div className="mb-3 flex flex-col items-center">
                  <img
                    src={primaryQr.qrCodeUrl}
                    alt=""
                    className="h-40 w-40 rounded-lg border object-contain"
                  />
                  <p className="mt-1 text-xs text-gray-600">{primaryQr.name}</p>
                </div>
              ) : null}
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
              <button
                type="button"
                disabled={uploading}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-800 disabled:opacity-50"
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? '上传中…' : '上传付款截图'}
              </button>
              {uploadErr ? <p className="mt-2 text-xs text-red-600">{uploadErr}</p> : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
