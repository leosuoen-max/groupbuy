import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
import { getShopBySlug } from '../../lib/shopService';
import type { OrderStatus } from '../../types/firestore';

type TabId = 'all' | 'open' | 'done' | 'cancelled';

function statusLabel(s: OrderStatus): string {
  if (s === 'unpaid') return '待付款';
  if (s === 'pending') return '待核实';
  if (s === 'confirmed') return '已确认';
  if (s === 'partial_paid') return '部分付款';
  if (s === 'cancelled') return '已取消';
  return s;
}

function tabMatches(tab: TabId, status: OrderStatus): boolean {
  if (tab === 'all') return true;
  if (tab === 'open') return status === 'unpaid' || status === 'pending';
  if (tab === 'done')
    return status === 'confirmed' || status === 'partial_paid';
  if (tab === 'cancelled') return status === 'cancelled';
  return true;
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

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setShopRow(null);
        setOrders([]);
        setErr('店铺不存在');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setShopRow(null);
        setOrders([]);
        setErr('无权限访问该店铺');
        return;
      }
      setShopRow({
        id: shop.id,
        slug: shop.data.slug,
        name: shop.data.name,
      });
      const rows = await listOrdersByShopId(shop.id);
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

  const filtered = useMemo(() => {
    let rows = orders;
    if (projectFilter.trim()) {
      rows = rows.filter((r) => r.data.projectId === projectFilter.trim());
    }
    return rows.filter((r) => tabMatches(tab, r.data.status));
  }, [orders, projectFilter, tab]);

  const counts = useMemo(() => {
    let base = orders;
    if (projectFilter.trim()) {
      base = base.filter((r) => r.data.projectId === projectFilter.trim());
    }
    return {
      all: base.length,
      open: base.filter((r) => tabMatches('open', r.data.status)).length,
      done: base.filter((r) => tabMatches('done', r.data.status)).length,
      cancelled: base.filter((r) => tabMatches('cancelled', r.data.status)).length,
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
          返回我的店铺
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
    { id: 'open', label: '待处理', count: counts.open },
    { id: 'done', label: '已确认', count: counts.done },
    { id: 'cancelled', label: '已取消', count: counts.cancelled },
  ];

  return (
    <PageShell title="订单管理" subtitle={shopRow?.name}>
      {err ? <p className="mb-2 text-sm text-amber-800">{err}</p> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <label className="block text-sm text-gray-700">
          筛选项目
          <select
            className="mt-1 block w-full max-w-xs rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={projectFilter}
            onChange={(e) => {
              const v = e.target.value;
              setSearchParams(v ? { project: v } : {});
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

      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-100 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === t.id
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="ml-1 tabular-nums opacity-80">({t.count})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-600">暂无订单。</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
          {filtered.map((row) => {
            const d = row.data;
            const pathSlug = shopRow?.slug ?? slug;
            const customerUrl = `/shop/${encodeURIComponent(pathSlug)}/${encodeURIComponent(d.projectId)}/orders/${encodeURIComponent(d.orderNumber)}`;
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900">
                    #{d.orderNumber}{' '}
                    <span className="font-normal text-gray-600">{d.customerName}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">
                    {d.projectTitle}
                    {' · '}
                    {statusLabel(d.status)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-medium tabular-nums text-gray-900">
                    {formatMYR(d.totalAmount)}
                  </span>
                  <Link
                    to={customerUrl}
                    className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                  >
                    查看详情
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6">
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
