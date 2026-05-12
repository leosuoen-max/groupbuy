import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { SignOutButton } from '../../components/SignOutButton';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import { aggregateShopOrdersForToday } from '../../lib/merchantDashboardStats';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
import {
  cardRequestNeedsMerchantConfirm,
  listCardRequestsByShop,
  type CardPurchaseRequestRow,
} from '../../lib/cardService';
import { getShopBySlug, isShopOpenForCustomers } from '../../lib/shopService';
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
  const shopPaused = !isShopOpenForCustomers(shop.data);

  return (
    <PageShell title={shop.data.name}>
      {shopPaused ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <strong>店铺已停用：</strong>顾客端无法进店、下单与购卡；你可继续在此处理历史订单与设置。需要恢复请在「平台 ·
          商户管理」中启用。
        </div>
      ) : null}
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
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-emerald-950 shadow-sm sm:px-3 sm:py-3">
              <div className="text-[11px] font-medium leading-tight text-emerald-800 sm:text-xs">已确认到账</div>
              <div className="mt-1 text-base font-bold tabular-nums sm:text-xl">
                {formatMYR(todayStats.confirmedRevenue)}
              </div>
              <div className="mt-0.5 text-[11px] text-emerald-800 sm:text-xs">
                {todayStats.confirmedCount} 单
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-2.5 text-amber-950 shadow-sm sm:px-3 sm:py-3">
              <div className="text-[11px] font-medium leading-tight text-amber-800 sm:text-xs">待确认</div>
              <div className="mt-1 text-base font-bold tabular-nums sm:text-xl">
                {formatMYR(todayStats.pendingReviewAmount)}
              </div>
              <div className="mt-0.5 text-[11px] text-amber-800 sm:text-xs">
                {todayStats.pendingReviewCount} 单
              </div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-2 py-2.5 text-rose-950 shadow-sm sm:px-3 sm:py-3">
              <div className="text-[11px] font-medium leading-tight text-rose-800 sm:text-xs">未付款</div>
              <div className="mt-1 text-base font-bold tabular-nums sm:text-xl">
                {formatMYR(todayStats.unpaidAmount)}
              </div>
              <div className="mt-0.5 text-[11px] text-rose-800 sm:text-xs">
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
      <div className="grid grid-cols-3 gap-1.5 overflow-visible sm:gap-2">
        <Link
          to={`${base}/projects`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          项目列表
        </Link>
        <Link
          to={`${base}/product-library`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          产品库
        </Link>
        <Link
          to={`${base}/orders`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          订单管理
        </Link>
        <Link
          to={`${base}/reconciliation`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          对账单
        </Link>
        <Link
          to={`${base}/settings`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          基本设置
        </Link>
        <Link
          to={`${base}/delivery-points`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          配送点
        </Link>
        <Link
          to={`${base}/admins`}
          className="flex min-h-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
        >
          管理员
        </Link>
        <Link
          to={`${base}/cards`}
          className="relative flex min-h-[3.25rem] items-center justify-center overflow-visible rounded-xl border border-gray-200 bg-white px-1.5 text-center text-xs font-medium leading-snug text-gray-900 shadow-sm active:bg-gray-50 sm:min-h-[3.5rem] sm:px-2 sm:text-sm"
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

      <div className="mt-6 border-t border-gray-100 pt-4">
        <SignOutButton
          returnTo={`/dashboard/${encodeURIComponent(shop.data.slug)}`}
          className="text-sm font-medium text-gray-700 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
          退出后进入<strong>用户登录</strong>页，仅支持已有手机号账号登录；换号登录请用另一号码收验证码。新商户请向站长索取一次性邀请链接。
        </p>
      </div>
    </PageShell>
  );
}
