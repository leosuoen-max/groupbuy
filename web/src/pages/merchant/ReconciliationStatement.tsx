import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  buildReconciliationCopyText,
  buildReconciliationCsv,
  buildReconciliationTotals,
} from '../../lib/reconciliationSummary';
import { orderHasPaymentScreenshots } from '../../lib/paymentScreenshotHelpers';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
import { getShopBySlug } from '../../lib/shopService';
import type { OrderStatus } from '../../types/firestore';

function statusLabel(s: OrderStatus): string {
  if (s === 'unpaid') return '待付款';
  if (s === 'pending') return '待核实';
  if (s === 'confirmed') return '已确认';
  if (s === 'partial_paid') return '部分付款';
  if (s === 'cancelled') return '已取消';
  return s;
}

function orderLinesSummary(lines: OrderRow['data']['lines']): string {
  if (!lines?.length) return '—';
  const first = lines[0];
  return lines.length > 1
    ? `${first.name}×${first.quantity} 等${lines.length}项`
    : `${first.name}×${first.quantity}`;
}

export default function ReconciliationStatement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') ?? '';

  const [err, setErr] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyOk, setCopyOk] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setOrders([]);
        setErr('店铺不存在');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setOrders([]);
        setErr('无权限访问该店铺');
        return;
      }
      setShopName(shop.data.name);
      setOrders(await listOrdersByShopId(shop.id));
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

  const scopedOrders = useMemo(() => {
    if (!projectFilter.trim()) return orders;
    return orders.filter((r) => r.data.projectId === projectFilter.trim());
  }, [orders, projectFilter]);

  const totals = useMemo(
    () => buildReconciliationTotals(scopedOrders),
    [scopedOrders]
  );

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of orders) {
      const id = r.data.projectId;
      const title = r.data.projectTitle?.trim() || id;
      m.set(id, title);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  const projectLabel =
    projectFilter && projectOptions.find((x) => x[0] === projectFilter)
      ? projectOptions.find((x) => x[0] === projectFilter)![1]
      : '全部项目';

  const sortedRows = useMemo(() => {
    return [...scopedOrders].sort((a, b) => {
      const ta = a.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.data.createdAt?.toMillis?.() ?? 0;
      return ta - tb;
    });
  }, [scopedOrders]);

  const handleCopy = async () => {
    const text = buildReconciliationCopyText({
      shopName,
      projectLabel,
      rows: scopedOrders,
      totals,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setCopyOk(false);
    }
  };

  const handleExportCsv = () => {
    const csv = '\ufeff' + buildReconciliationCsv(scopedOrders);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `对账单-${slug}-${projectFilter || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const baseDash = `/dashboard/${encodeURIComponent(slug)}`;

  if (authLoading || (user && loading)) {
    return (
      <PageShell title="对账单" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="对账单" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (err && !shopName) {
    return (
      <PageShell title="对账单" subtitle="错误">
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

  return (
    <PageShell title="对账单" subtitle={`${shopName} · 与收款流水对账用`}>
      {err ? <p className="mb-2 text-sm text-amber-800">{err}</p> : null}

      <p className="mb-4 text-xs text-gray-600">
        汇总口径与 docs/04 一致：已确认到账、待核实、未付款；可与 TNG / DuitNow /
        银行等收款明细逐笔核对。
      </p>

      <div className="mb-4">
        <label className="block text-sm text-gray-800">
          筛选项目
          <select
            className="mt-1 block w-full max-w-md rounded-lg border border-gray-200 px-3 py-2 text-sm"
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

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="text-xs font-medium text-emerald-800">已确认到账</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
            {formatMYR(totals.confirmedAmount)}
          </div>
          <div className="text-xs text-emerald-800">{totals.confirmedCount} 单</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="text-xs font-medium text-amber-900">待核实金额</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-amber-950">
            {formatMYR(totals.pendingAmount)}
          </div>
          <div className="text-xs text-amber-900">{totals.pendingCount} 单</div>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <div className="text-xs font-medium text-red-900">未付款</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-red-950">
            {formatMYR(totals.unpaidAmount)}
          </div>
          <div className="text-xs text-red-900">{totals.unpaidCount} 单</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-xs font-medium text-gray-700">订单总额（未取消）</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-gray-900">
            {formatMYR(totals.totalActiveAmount)}
          </div>
          <div className="text-xs text-gray-600">{totals.activeCount} 单</div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
        <div className="font-medium">声称已付（业务侧）</div>
        <div className="mt-1 tabular-nums">
          {formatMYR(totals.claimedPaidAmount)} · {totals.claimedPaidCount} 单
        </div>
        <p className="mt-1 text-xs text-indigo-900/90">
          含已上传截图或状态为待核实/已确认/部分付款的订单，便于与通道侧「客户声称已付」对照。
        </p>
      </div>

      {totals.effectiveRatePercent != null ? (
        <p className="mb-4 text-sm text-gray-700">
          有效订单率（已确认单数 / 未取消单数）：
          <strong>{totals.effectiveRatePercent}%</strong>
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
          onClick={() => void handleCopy()}
        >
          {copyOk ? '已复制' : '复制对账清单'}
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-900"
          onClick={handleExportCsv}
        >
          导出 CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-700">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">付款方</th>
              <th className="px-3 py-2">订单</th>
              <th className="px-3 py-2">内容</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">凭证</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedRows.map((row) => {
              const o = row.data;
              const d = o.createdAt?.toDate?.();
              const pad = (n: number) => String(n).padStart(2, '0');
              const timeStr = d
                ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
                : '—';
              const hasShot = orderHasPaymentScreenshots(o.paymentScreenshots);
              return (
                <tr key={row.id} className="bg-white">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{timeStr}</td>
                  <td className="px-3 py-2 text-gray-900">{o.customerName}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    #{o.orderNumber}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-gray-700">
                    {orderLinesSummary(o.lines)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums font-medium">
                    {formatMYR(o.totalAmount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{statusLabel(o.status)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {hasShot ? (
                      <span className="text-emerald-700">有</span>
                    ) : (
                      <span className="text-gray-400">无</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          to={`${baseDash}/orders`}
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          ← 订单管理
        </Link>
        <Link
          to={baseDash}
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          后台首页
        </Link>
      </div>
    </PageShell>
  );
}
