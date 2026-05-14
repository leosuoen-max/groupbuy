import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { EmptyStateCard } from '../components/ui/EmptyStateCard';
import { StatusChip } from '../components/ui/StatusChip';
import { useAuthUser } from '../hooks/useAuthUser';
import { isFeituanAdmin } from '../lib/feituanService';
import { formatMYR } from '../lib/formatMYR';
import { listFeituanOrders, type OrderRow } from '../lib/orderService';
import { buildPaymentGroups, type PaymentGroup } from '../lib/paymentGroups';
import { deriveDisplayOrderStatus } from '../lib/paymentGroupView';
import {
  orderHasPaymentProof,
  orderHasPaymentScreenshots,
} from '../lib/paymentScreenshotHelpers';
import type { OrderStatus } from '../types/firestore';

type TabId = 'all' | 'unpaid' | 'open' | 'done' | 'cancelled';

function statusLabel(s: OrderStatus): string {
  if (s === 'unpaid') return '待付款';
  if (s === 'pending') return '待确认';
  if (s === 'confirmed') return '已确认';
  if (s === 'partial_paid') return '部分已确认';
  if (s === 'cancelled') return '已取消';
  return s;
}

function tabMatches(view: FeituanOrderView, tab: TabId): boolean {
  if (tab === 'all') return true;
  if (tab === 'unpaid') return view.groups.some((g) => g.status === 'unpaid');
  if (tab === 'open') return view.groups.some((g) => g.status === 'pending');
  if (tab === 'done') return view.groups.some((g) => g.status === 'confirmed');
  if (tab === 'cancelled') return view.row.data.status === 'cancelled';
  return true;
}

function toChipTone(s: OrderStatus): 'confirmed' | 'pending' | 'unpaid' | 'cancelled' {
  if (s === 'confirmed') return 'confirmed';
  if (s === 'pending') return 'pending';
  if (s === 'unpaid' || s === 'partial_paid') return 'unpaid';
  return 'cancelled';
}

function fmtTime(t: { toDate?: () => Date } | null | undefined): string {
  const d = t?.toDate?.();
  if (!d) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

type FeituanOrderView = {
  row: OrderRow;
  groups: PaymentGroup[];
  displayStatus: OrderStatus;
};

export default function FeituanOrders() {
  const { user, loading: authLoading } = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('all');
  const [keyword, setKeyword] = useState('');

  const projectFilter = searchParams.get('project') ?? '';

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) {
        setOrders([]);
        return;
      }
      setOrders(await listFeituanOrders());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => {
      if (!user) {
        setAllowed(false);
        setOrders([]);
        setLoading(false);
        return;
      }
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, refresh, user]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (!authLoading && user) void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [authLoading, refresh, user]);

  const orderViews = useMemo<FeituanOrderView[]>(
    () =>
      orders.map((row) => {
        const groups = buildPaymentGroups(row.data);
        return {
          row,
          groups,
          displayStatus: deriveDisplayOrderStatus(row.data, groups),
        };
      }),
    [orders]
  );

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const view of orderViews) {
      const id = view.row.data.projectId;
      const title = view.row.data.projectTitle?.trim() || id;
      if (!m.has(id)) m.set(id, title);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orderViews]);

  const filteredViews = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = orderViews.filter((view) => {
      const o = view.row.data;
      if (projectFilter && o.projectId !== projectFilter) return false;
      if (!tabMatches(view, tab)) return false;
      if (!kw) return true;
      return [
        o.orderNumber,
        o.projectTitle,
        o.customerName,
        o.customerPhone,
        o.customerAddress,
        o.deliveryPointSnapshot?.name,
      ]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(kw));
    });
    return [...list].sort((a, b) => {
      const ap = a.groups.some((g) => g.status === 'pending') ? 1 : 0;
      const bp = b.groups.some((g) => g.status === 'pending') ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const au = a.groups.some((g) => g.status === 'unpaid') ? 1 : 0;
      const bu = b.groups.some((g) => g.status === 'unpaid') ? 1 : 0;
      if (au !== bu) return bu - au;
      const ta = a.row.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.row.data.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [keyword, orderViews, projectFilter, tab]);

  const counts = useMemo(
    () => ({
      all: orderViews.length,
      pending: orderViews.filter((o) =>
        o.groups.some((g) => g.status === 'pending')
      ).length,
      unpaid: orderViews.filter((o) =>
        o.groups.some((g) => g.status === 'unpaid')
      ).length,
      done: orderViews.filter((o) =>
        o.groups.some((g) => g.status === 'confirmed')
      ).length,
    }),
    [orderViews]
  );

  if (authLoading || loading) {
    return (
      <PageShell title="饭团订单" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="饭团订单" subtitle="未登录">
        <Link to="/login?returnTo=/admin/feituan/orders" className="text-indigo-600">
          去登录
        </Link>
      </PageShell>
    );
  }

  if (allowed == null) {
    return (
      <PageShell title="饭团订单" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="饭团订单" subtitle="无权限">
        <p className="text-sm text-gray-700">当前账号无饭团管理员权限。</p>
      </PageShell>
    );
  }

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: counts.all },
    { id: 'unpaid', label: '待付款', count: counts.unpaid },
    { id: 'open', label: '待确认', count: counts.pending },
    { id: 'done', label: '已确认', count: counts.done },
    { id: 'cancelled', label: '已取消', count: orderViews.filter((o) => o.row.data.status === 'cancelled').length },
  ];

  return (
    <PageShell
      title="饭团订单"
      subtitle={`全部 ${counts.all} · 待确认 ${counts.pending} · 待付款 ${counts.unpaid}`}
    >
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}

      <section className="mb-3 space-y-3 rounded-xl border border-gray-100 bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-gray-700">
            筛选项目
            <select
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={projectFilter}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value) next.set('project', e.target.value);
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
          <label className="block text-sm text-gray-700">
            搜索订单 / 顾客 / 电话 / 地址
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="例如：订单号、顾客名、手机号后四位"
            />
          </label>
        </div>
      </section>

      <p className="mb-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-950">
        <strong>说明：</strong>
        本页仅列出<strong>饭团订单</strong>。同一订单可同时包含待确认、待付款、已确认支付组，
        因此会同时计入多个标签；列表按待确认优先、待付款其次排序。
      </p>
      <p className="mb-3 text-xs text-gray-500">
        复杂核对请进入详情页处理。顾客上传截图后如列表未更新，请点击
        <strong className="font-medium text-gray-700">刷新列表</strong>
        或切换应用再回来。
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新列表'}
        </button>
        <Link
          to="/admin/feituan"
          className="inline-flex h-9 items-center rounded-lg border border-orange-200 bg-orange-50 px-3 text-sm font-medium text-orange-900"
        >
          返回饭团管理
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1.5">
        {tabs.map((x) => {
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                active ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {x.label}
              <span className="ml-1 tabular-nums opacity-80">({x.count})</span>
            </button>
          );
        })}
      </div>

      {orderViews.length === 0 ? (
        <EmptyStateCard title="暂无饭团订单" hint="顾客在饭团项目下单后，这里会显示订单。" />
      ) : filteredViews.length === 0 ? (
        <EmptyStateCard title="暂无订单" hint="可切换其他标签、调整项目筛选或清空搜索词。" />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
          {filteredViews.map(({ row, groups, displayStatus }) => {
            const o = row.data;
            const pendingGroups = groups.filter((g) => g.status === 'pending').length;
            const unpaidGroups = groups.filter((g) => g.status === 'unpaid').length;
            const confirmedGroups = groups.filter((g) => g.status === 'confirmed').length;
            const autoGroups = groups.filter((g) => g.hasCardAuto).length;
            const proofEntries = groups.flatMap((g) => g.proofs);
            const thumbUrl = proofEntries.find((p) => p.url)?.url ?? null;
            const hasShot = orderHasPaymentScreenshots(o.paymentScreenshots);
            const hasProofNoImage = !hasShot && orderHasPaymentProof(o.paymentScreenshots);
            const detailUrl = `/admin/feituan/order/${encodeURIComponent(o.projectId)}/${encodeURIComponent(o.orderNumber)}`;
            const customerUrl = `/feituan/projects/${encodeURIComponent(o.projectId)}/orders/${encodeURIComponent(o.orderNumber)}`;
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
                      #{o.orderNumber}{' '}
                      <span className="font-normal text-gray-600">{o.customerName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                      <span className="truncate">{o.projectTitle}</span>
                      <StatusChip
                        tone={toChipTone(displayStatus)}
                        label={statusLabel(displayStatus)}
                      />
                      {hasShot ? (
                        <span className="font-medium text-emerald-700">已传凭证</span>
                      ) : null}
                      {hasProofNoImage ? (
                        <span className="font-medium text-amber-700">免凭证</span>
                      ) : null}
                      {autoGroups > 0 ? (
                        <span className="font-medium text-emerald-700">卡/钱包自动确认</span>
                      ) : null}
                      {!hasShot && !hasProofNoImage && autoGroups === 0 ? (
                        <span className="text-gray-400">未传图</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {fmtTime(o.createdAt)} · {o.customerPhone} · {o.deliveryPointSnapshot?.name ?? '未填写配送'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      支付组 {groups.length} 组 · 待确认 {pendingGroups} · 待付款 {unpaidGroups} · 已确认 {confirmedGroups}
                      {autoGroups > 0 ? ` · 自动确认 ${autoGroups}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-medium tabular-nums text-gray-900">
                    {formatMYR(o.totalAmount)}
                  </span>
                  <span className="text-xs text-gray-500">
                    待付 {formatMYR(o.pendingAmount ?? 0)}
                  </span>
                  <Link
                    to={detailUrl}
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
          to="/admin/feituan/reconciliation"
          className="inline-flex h-10 items-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
        >
          饭团对账
        </Link>
        <Link
          to="/admin/feituan"
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          ← 返回饭团管理
        </Link>
      </div>
    </PageShell>
  );
}
