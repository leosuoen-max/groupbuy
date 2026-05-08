import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import { aggregateShopOrdersForToday } from '../../lib/merchantDashboardStats';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
import {
  cardRequestNeedsMerchantConfirm,
  listCardRequestsByShop,
  type CardPurchaseRequestRow,
} from '../../lib/cardService';
import { getShopBySlug } from '../../lib/shopService';
import type { ShopRow } from '../../lib/shopService';

export default function MerchantDashboard() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const { user, loading: authLoading } = useAuthUser();
  const [shop, setShop] = useState<ShopRow | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);
  const [cardPurchaseRows, setCardPurchaseRows] = useState<
    CardPurchaseRequestRow[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr(null);
      try {
        const row = await getShopBySlug(decodeURIComponent(shopSlug));
        if (!cancelled) setShop(row);
      } catch (e) {
        if (!cancelled) {
          setShop(null);
          setErr(e instanceof Error ? e.message : '加载失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopSlug]);

  useEffect(() => {
    if (!shop || !user || shop.data.ownerId !== user.uid) {
      queueMicrotask(() => {
        setOrderRows([]);
        setOrdersErr(null);
        setOrdersLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      setOrdersLoading(true);
      setOrdersErr(null);
    });
    void listOrdersByShopId(shop.id)
      .then((rows) => {
        if (!cancelled) setOrderRows(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setOrderRows([]);
          setOrdersErr(e instanceof Error ? e.message : '订单统计加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shop, user]);

  useEffect(() => {
    if (!shop || !user || shop.data.ownerId !== user.uid) {
      queueMicrotask(() => setCardPurchaseRows([]));
      return;
    }
    let cancelled = false;
    void listCardRequestsByShop(shop.id)
      .then((rows) => {
        if (!cancelled) setCardPurchaseRows(rows);
      })
      .catch(() => {
        if (!cancelled) setCardPurchaseRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shop, user]);

  const pendingCardConfirmCount = useMemo(
    () =>
      cardPurchaseRows.filter((r) => cardRequestNeedsMerchantConfirm(r.data))
        .length,
    [cardPurchaseRows]
  );

  const todayStats = useMemo(
    () => aggregateShopOrdersForToday(orderRows),
    [orderRows]
  );

  const dateLabel = useMemo(() => {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }, []);

  if (authLoading || shop === undefined) {
    return (
      <PageShell title="商户后台" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="商户后台" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  if (err || !shop) {
    return (
      <PageShell title="商户后台" subtitle="未找到链接">
        <p className="text-sm text-gray-600">
          {err ?? '链接不存在或已被删除。'}
        </p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  if (shop.data.ownerId !== user.uid) {
    return (
      <PageShell title="商户后台" subtitle="无权限">
        <p className="text-sm text-gray-600">
          你不是该商户的创建人，无法查看此后台首页。
        </p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  const base = `/dashboard/${encodeURIComponent(shop.data.slug)}`;

  return (
    <PageShell title={shop.data.name}>
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          今日数据 <span className="font-normal text-gray-500">（{dateLabel} · 按本机时区统计创建日）</span>
        </h2>
        {ordersErr ? (
          <p className="mb-2 text-sm text-amber-800">{ordersErr}</p>
        ) : null}
        {ordersLoading ? (
          <p className="text-sm text-gray-500">正在统计今日订单…</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-950 shadow-sm">
              <div className="text-xs font-medium text-emerald-800">已确认到账</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {formatMYR(todayStats.confirmedRevenue)}
              </div>
              <div className="mt-0.5 text-xs text-emerald-800">
                {todayStats.confirmedCount} 单
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-amber-950 shadow-sm">
              <div className="text-xs font-medium text-amber-800">待确认</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {formatMYR(todayStats.pendingReviewAmount)}
              </div>
              <div className="mt-0.5 text-xs text-amber-800">
                {todayStats.pendingReviewCount} 单
              </div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-rose-950 shadow-sm">
              <div className="text-xs font-medium text-rose-800">未付款</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {formatMYR(todayStats.unpaidAmount)}
              </div>
              <div className="mt-0.5 text-xs text-rose-800">
                {todayStats.unpaidCount} 单
              </div>
            </div>
          </div>
        )}
      </section>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">快捷入口</h2>
      {pendingCardConfirmCount > 0 ? (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <span className="font-semibold text-amber-900">优惠卡：</span>
          当前有{' '}
          <strong className="tabular-nums">{pendingCardConfirmCount}</strong>{' '}
          笔购卡/充值<strong>待确认到账</strong>
          （顾客已传截图）。请到「优惠卡」页面处理。
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 overflow-visible sm:grid-cols-3">
        <Link
          to={`${base}/projects`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          项目列表
        </Link>
        <Link
          to={`${base}/orders`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          订单管理
        </Link>
        <Link
          to={`${base}/reconciliation`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          对账单
        </Link>
        <Link
          to={`${base}/settings`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          基本设置
        </Link>
        <Link
          to={`${base}/delivery-points`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          配送点
        </Link>
        <Link
          to={`${base}/admins`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          管理员
        </Link>
        <Link
          to={`${base}/cards`}
          className="relative flex min-h-[3.5rem] items-center justify-center overflow-visible rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          <span className="relative z-0 px-3">优惠卡</span>
          {pendingCardConfirmCount > 0 ? (
            <>
              <span
                className="pointer-events-none absolute right-2 top-2 z-10 flex h-3 w-3 items-center justify-center"
                aria-hidden
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600 ring-2 ring-white" />
              </span>
              <span className="sr-only">
                {pendingCardConfirmCount} 笔优惠卡购卡或充值待确认
              </span>
            </>
          ) : null}
        </Link>
      </div>
    </PageShell>
  );
}
