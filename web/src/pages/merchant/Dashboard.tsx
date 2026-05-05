import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import { aggregateShopOrdersForToday } from '../../lib/merchantDashboardStats';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
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
      <PageShell title="店铺后台" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="店铺后台" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (err || !shop) {
    return (
      <PageShell title="店铺后台" subtitle="未找到店铺">
        <p className="text-sm text-gray-600">
          {err ?? '链接不存在或已被删除。'}
        </p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (shop.data.ownerId !== user.uid) {
    return (
      <PageShell title="店铺后台" subtitle="无权限">
        <p className="text-sm text-gray-600">
          你不是该店铺的创建人，无法查看此后台首页。
        </p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  const base = `/dashboard/${encodeURIComponent(shop.data.slug)}`;

  return (
    <PageShell title={shop.data.name} subtitle={`/${shop.data.slug}`}>
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
              <div className="text-xs font-medium text-amber-800">待核实</div>
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
        {!ordersLoading && !ordersErr ? (
          <p className="mt-2 text-xs text-gray-500">
            今日有效单共 {todayStats.todayOpenOrdersCount} 笔（已排除已取消；待核实含待补款等需跟进的单）。
          </p>
        ) : null}
      </section>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">快捷入口</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
          店铺设置
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
          to="/dashboard"
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-dashed border-gray-300 px-2 text-center text-sm font-medium text-gray-700"
        >
          切换店铺
        </Link>
      </div>
    </PageShell>
  );
}
