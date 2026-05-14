import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { isFeituanAdmin } from '../lib/feituanService';
import { formatMYR } from '../lib/formatMYR';
import {
  listFeituanOrders,
  merchantConfirmPaymentGroup,
  type OrderRow,
} from '../lib/orderService';
import { buildPaymentGroups, type PaymentGroup } from '../lib/paymentGroups';
import { deriveDisplayOrderStatus } from '../lib/paymentGroupView';
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

function statusTone(s: OrderStatus): string {
  if (s === 'confirmed') return 'bg-emerald-100 text-emerald-900';
  if (s === 'pending') return 'bg-indigo-100 text-indigo-900';
  if (s === 'unpaid' || s === 'partial_paid') return 'bg-amber-100 text-amber-900';
  return 'bg-gray-200 text-gray-700';
}

function groupStatusLabel(s: PaymentGroup['status']): string {
  if (s === 'unpaid') return '待付款';
  if (s === 'pending') return '待确认';
  if (s === 'confirmed') return '已确认';
  return s;
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
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const confirm = async (row: OrderRow, groupId: string) => {
    if (!user) return;
    setBusyId(`${row.id}:${groupId}`);
    setErr(null);
    try {
      await merchantConfirmPaymentGroup(row.id, groupId, user.uid);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '确认失败');
    } finally {
      setBusyId(null);
    }
  };

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
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
        <Link
          to="/admin/feituan"
          className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-900"
        >
          返回饭团管理
        </Link>
      </div>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}

      <section className="mb-3 space-y-3 rounded-xl border border-gray-100 bg-white p-3">
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
      </section>

      <div className="mb-3 grid grid-cols-5 gap-1.5 rounded-xl border border-gray-100 bg-white p-1">
        {tabs.map((x) => {
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={`rounded-lg px-1 py-2 text-xs font-semibold ${
                active ? 'bg-orange-500 text-white' : 'text-gray-600 active:bg-orange-50'
              }`}
            >
              <span className="block">{x.label}</span>
              <span className={active ? 'text-white/80' : 'text-gray-400'}>{x.count}</span>
            </button>
          );
        })}
      </div>

      {orderViews.length === 0 ? (
        <p className="text-sm text-gray-600">暂无饭团订单。</p>
      ) : filteredViews.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">
          当前筛选下没有订单。
        </p>
      ) : (
        <div className="space-y-3">
          {filteredViews.map(({ row, groups, displayStatus }) => {
            const o = row.data;
            const pendingGroups = groups.filter((g) => g.status === 'pending').length;
            const unpaidGroups = groups.filter((g) => g.status === 'unpaid').length;
            const proofCount = groups.reduce((sum, g) => sum + g.proofs.length, 0);
            return (
              <article
                key={row.id}
                className={`rounded-xl border border-gray-100 bg-white p-4 text-sm shadow-sm ${
                  pendingGroups > 0 ? 'border-l-4 border-l-indigo-500' : ''
                }`}
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      #{o.orderNumber} · {o.projectTitle}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {o.customerName} · {o.customerPhone} · {fmtTime(o.createdAt)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {o.customerAddress}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(displayStatus)}`}>
                    {statusLabel(displayStatus)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">
                  <div>金额：{formatMYR(o.totalAmount)}</div>
                  <div>待付：{formatMYR(o.pendingAmount ?? 0)}</div>
                  <div>配送：{o.deliveryPointSnapshot?.name ?? '未填写'}</div>
                  <div>
                    支付组：{groups.length} · 待确认 {pendingGroups} · 待付 {unpaidGroups}
                  </div>
                </div>
                {proofCount > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-emerald-700">
                    <span>付款凭证 {proofCount} 张</span>
                    {groups
                      .flatMap((g) => g.proofs)
                      .filter((p): p is typeof p & { url: string } => Boolean(p.url))
                      .slice(0, 3)
                      .map((p, i) => (
                        <a
                          key={`${p.url}-${i}`}
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-10 w-10 overflow-hidden rounded-lg border border-emerald-100 bg-white"
                        >
                          <img src={p.url} alt="付款凭证" className="h-full w-full object-cover" />
                        </a>
                      ))}
                  </div>
                ) : null}
                <div className="mt-3 space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-2">
                  {groups.map((g, index) => {
                    const busyKey = `${row.id}:${g.id}`;
                    return (
                      <div
                        key={g.id}
                        className="rounded-lg border border-gray-100 bg-white px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-900">
                              支付组 {index + 1} · {groupStatusLabel(g.status)}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {formatMYR(g.subtotal)} · {g.lines.length} 项
                              {g.proofs.length > 0 ? ` · 凭证 ${g.proofs.length} 张` : ''}
                              {g.hasCardAuto ? ' · 卡/钱包自动确认' : ''}
                            </p>
                          </div>
                          {g.status === 'pending' ? (
                            <button
                              type="button"
                              disabled={busyId === busyKey}
                              onClick={() => void confirm(row, g.id)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300"
                            >
                              {busyId === busyKey ? '确认中…' : '确认本组收款'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to={`/admin/feituan/order/${encodeURIComponent(o.projectId)}/${encodeURIComponent(o.orderNumber)}`}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
                  >
                    查看订单详情
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
