import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { EmptyStateCard } from '../../components/ui/EmptyStateCard';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  orderHasPaymentProof,
  orderHasPaymentScreenshots,
  parseScreenshotEntries,
} from '../../lib/paymentScreenshotHelpers';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
import { getShopBySlug } from '../../lib/shopService';
import { buildPaymentGroups } from '../../lib/paymentGroups';
import { deriveDisplayOrderStatus } from '../../lib/paymentGroupView';
import type { OrderDoc, OrderStatus } from '../../types/firestore';

type TabId = 'all' | 'unpaid' | 'open' | 'done' | 'cancelled';

function statusLabel(s: OrderStatus): string {
  if (s === 'unpaid') return '待付款';
  if (s === 'pending') return '待确认';
  if (s === 'confirmed') return '已确认';
  if (s === 'partial_paid') return '待付款';
  if (s === 'cancelled') return '已取消';
  return s;
}

function toChipTone(s: OrderStatus): 'confirmed' | 'pending' | 'unpaid' | 'cancelled' {
  if (s === 'confirmed') return 'confirmed';
  if (s === 'pending') return 'pending';
  if (s === 'unpaid' || s === 'partial_paid') return 'unpaid';
  return 'cancelled';
}

/** 只要订单里已有任一支付组被确认入账，就应计入“已确认”视图（含部分已确认）。 */
function orderHasAnyConfirmedPayment(order: OrderDoc): boolean {
  return buildPaymentGroups(order).some((g) => g.status === 'confirmed');
}

function orderHasAnyPendingPayment(order: OrderDoc): boolean {
  return buildPaymentGroups(order).some((g) => g.status === 'pending');
}

function orderHasAnyUnpaidPayment(order: OrderDoc): boolean {
  return buildPaymentGroups(order).some((g) => g.status === 'unpaid');
}

export default function OrderManagement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [err, setErr] = useState<string | null>(null);
  const [shopRow, setShopRow] = useState<{ id: string; slug: string; name: string } | null>(
    null
  );
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('all');

  const projectFilter = searchParams.get('project') ?? '';

  const refresh = useCallback(async (opts?: { bypassCache?: boolean }) => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setShopRow(null);
        setOrders([]);
        setErr('未找到该商户链接');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setShopRow(null);
        setOrders([]);
        setErr('无权限访问该商户');
        return;
      }
      setShopRow({
        id: shop.id,
        slug: shop.data.slug,
        name: shop.data.name,
      });
      const rows = await listOrdersByShopId(shop.id, {
        bypassCache: opts?.bypassCache === true,
      });
      setOrders(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [slug, user]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!authLoading && user) void refresh();
      else if (!authLoading && !user) setLoading(false);
    });
  }, [authLoading, user, refresh]);

  /** 手机端常前台停留在订单列表：切回浏览器/后台时应拉最新，避免「顾客已传图但列表仍是旧的」 */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (!authLoading && user) void refresh({ bypassCache: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [authLoading, user, refresh]);

  const filtered = useMemo(() => {
    const derived = orders.map((r) => {
      const d = r.data;
      return {
        row: r,
        isUnpaid: orderHasAnyUnpaidPayment(d),
        isOpen: orderHasAnyPendingPayment(d),
        isDone: orderHasAnyConfirmedPayment(d),
        isCancelled: d.status === 'cancelled',
      };
    });

    let rows = derived;
    if (projectFilter.trim()) {
      rows = rows.filter((r) => r.row.data.projectId === projectFilter.trim());
    }
    if (tab === 'all') return rows.map((r) => r.row);
    if (tab === 'unpaid') return rows.filter((r) => r.isUnpaid).map((r) => r.row);
    if (tab === 'open') return rows.filter((r) => r.isOpen).map((r) => r.row);
    if (tab === 'done') return rows.filter((r) => r.isDone).map((r) => r.row);
    if (tab === 'cancelled') {
      return rows.filter((r) => r.isCancelled).map((r) => r.row);
    }
    return rows.map((r) => r.row);
  }, [orders, projectFilter, tab]);

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const ta = a.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.data.createdAt?.toMillis?.() ?? 0;
      if (ta !== tb) return tb - ta;
      return a.data.orderNumber.localeCompare(b.data.orderNumber);
    });
    return list;
  }, [filtered]);

  const counts = useMemo(() => {
    const derived = orders.map((r) => {
      const d = r.data;
      return {
        row: r,
        isUnpaid: orderHasAnyUnpaidPayment(d),
        isOpen: orderHasAnyPendingPayment(d),
        isDone: orderHasAnyConfirmedPayment(d),
        isCancelled: d.status === 'cancelled',
      };
    });
    let base = derived;
    if (projectFilter.trim()) {
      base = base.filter((r) => r.row.data.projectId === projectFilter.trim());
    }
    return {
      all: base.length,
      unpaid: base.filter((r) => r.isUnpaid).length,
      open: base.filter((r) => r.isOpen).length,
      done: base.filter((r) => r.isDone).length,
      cancelled: base.filter((r) => r.isCancelled).length,
    };
  }, [orders, projectFilter]);

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of orders) {
      const id = r.data.projectId;
      const title = r.data.projectTitle?.trim() || id;
      if (!m.has(id)) m.set(id, title);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  const baseDash = `/dashboard/${encodeURIComponent(slug)}`;

  if (authLoading || (user && loading)) {
    return (
      <PageShell title="订单管理" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="订单管理" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  if (err && !shopRow) {
    return (
      <PageShell title="订单管理" subtitle="错误">
        <p className="text-sm text-red-600">{err}</p>
        <Link
          className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to="/dashboard"
        >
          返回
        </Link>
      </PageShell>
    );
  }

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: counts.all },
    { id: 'unpaid', label: '待付款', count: counts.unpaid },
    { id: 'open', label: '待确认', count: counts.open },
    { id: 'done', label: '已确认', count: counts.done },
    { id: 'cancelled', label: '已取消', count: counts.cancelled },
  ];

  return (
    <PageShell title="订单管理" subtitle={shopRow?.name}>
      {err ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {err}
        </p>
      ) : null}

      <div className="mb-3 rounded-xl border border-gray-100 bg-white p-3">
        <label className="block text-sm text-gray-700">
          筛选项目
          <select
            className="mt-1 block w-full max-w-xs rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={projectFilter}
            onChange={(e) => {
              const v = e.target.value;
              const next = new URLSearchParams(searchParams);
              if (v) next.set('project', v);
              else next.delete('project');
              setSearchParams(next);
            }}
          >
            <option value="">全部项目</option>
            {projectOptions.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-950">
        <strong>说明：</strong>
        本页仅列出<strong>团购/点餐订单</strong>（菜品配送）。
        顾客<strong>购买或充值钱包、次卡</strong>并上传付款凭证的请求<strong>不会出现在此处</strong>，
        请到「优惠卡」点击对应卡模板的<strong>详情</strong>，在页面顶部查看待确认的购卡/充值记录。
        <Link
          className="ml-1 font-semibold text-indigo-700 underline-offset-2 hover:underline"
          to={`${baseDash}/cards`}
        >
          打开优惠卡管理
        </Link>
      </p>

      <p className="mb-3 text-xs text-gray-500">
        同一订单可同时出现在多个标签：例如首单待确认(pending)时又加购未付→会在「待确认」与「待付款」各出现一笔（同一订单号）。
      </p>
      <p className="mb-3 text-xs text-gray-500">
        <strong className="font-medium text-gray-700">待确认</strong>
        仅包含<strong className="font-medium text-gray-700">已上传付款截图</strong>
        （或商户设为免凭证）的订单；顾客若只提交订单尚未传图，订单在
        <strong className="font-medium text-gray-700">待付款</strong>。列表不会实时推送，顾客传图后请点下方
        <strong className="font-medium text-gray-700">刷新列表</strong>
        或切换应用再回来。
      </p>

      <div className="mb-3">
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
          onClick={() => void refresh({ bypassCache: true })}
          disabled={loading || !user}
        >
          {loading ? '刷新中…' : '刷新列表'}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === t.id
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="ml-1 tabular-nums opacity-80">({t.count})</span>
          </button>
        ))}
      </div>

      {sortedFiltered.length === 0 ? (
        <EmptyStateCard title="暂无订单" hint="可切换其他标签或调整项目筛选。" />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
          {sortedFiltered.map((row) => {
            const d = row.data;
            const pathSlug = shopRow?.slug ?? slug;
            const merchantDetailUrl = `/dashboard/${encodeURIComponent(pathSlug)}/order/${encodeURIComponent(d.projectId)}/${encodeURIComponent(d.orderNumber)}`;
            const customerUrl = `/shop/${encodeURIComponent(pathSlug)}/${encodeURIComponent(d.projectId)}/orders/${encodeURIComponent(d.orderNumber)}`;
            const shots = parseScreenshotEntries(d.paymentScreenshots);
            const thumbUrl = shots.find((s) => s.url)?.url ?? null;
            const hasShot = orderHasPaymentScreenshots(d.paymentScreenshots);
            const hasProofNoImage =
              !hasShot && orderHasPaymentProof(d.paymentScreenshots);
            const displayStatus = deriveDisplayOrderStatus(d);
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm">
                <div className="flex min-w-0 flex-1 gap-3">
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg border border-gray-100 object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-[10px] leading-tight text-gray-400">
                      无
                      <br />
                      凭证
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900">
                      #{d.orderNumber}{' '}
                      <span className="font-normal text-gray-600">{d.customerName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                      <span className="truncate">{d.projectTitle}</span>
                      <StatusChip
                        tone={toChipTone(displayStatus)}
                        label={statusLabel(displayStatus)}
                      />
                      {hasShot ? (
                        <span className="font-medium text-emerald-700">已传凭证</span>
                      ) : hasProofNoImage ? (
                        <span className="font-medium text-amber-700">免凭证</span>
                      ) : (
                        <span className="text-gray-400">未传图</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-medium tabular-nums text-gray-900">
                    {formatMYR(d.totalAmount)}
                  </span>
                  <Link
                    to={merchantDetailUrl}
                    className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                  >
                    查看并处理
                  </Link>
                  <Link
                    to={customerUrl}
                    className="text-xs font-medium text-gray-500 underline-offset-2 hover:underline"
                  >
                    顾客视图
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          to={`${baseDash}/reconciliation`}
          className="inline-flex h-10 items-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
        >
          对账单
        </Link>
        <Link
          to={baseDash}
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          ← 返回后台
        </Link>
      </div>
    </PageShell>
  );
}
