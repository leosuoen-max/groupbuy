import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { ActionButton } from '../../components/ui/ActionButton';
import { EmptyStateCard } from '../../components/ui/EmptyStateCard';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  buildReconciliationCopyText,
  buildReconciliationCsv,
  buildReconciliationTotals,
} from '../../lib/reconciliationSummary';
import {
  orderHasPaymentProof,
  parseScreenshotEntries,
} from '../../lib/paymentScreenshotHelpers';
import {
  listOrdersByShopId,
  merchantConfirmPayment,
  type OrderRow,
} from '../../lib/orderService';
import { getShopBySlug } from '../../lib/shopService';
import type { OrderStatus } from '../../types/firestore';

function statusLabel(s: OrderStatus): string {
  if (s === 'unpaid') return '待付款';
  if (s === 'pending') return '待确认';
  if (s === 'confirmed') return '已确认';
  if (s === 'partial_paid') return '待付款';
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

function toChipTone(s: OrderStatus): 'confirmed' | 'pending' | 'unpaid' | 'cancelled' {
  if (s === 'confirmed') return 'confirmed';
  if (s === 'pending') return 'pending';
  if (s === 'unpaid' || s === 'partial_paid') return 'unpaid';
  return 'cancelled';
}

export default function ReconciliationStatement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') ?? '';
  const proofStart = searchParams.get('proofStart') ?? '';
  const proofEnd = searchParams.get('proofEnd') ?? '';

  const [err, setErr] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyOk, setCopyOk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  function parseDateTimeMs(yyyyMmDdHhMm: string): number | null {
    if (!yyyyMmDdHhMm.trim()) return null;
    const ms = new Date(yyyyMmDdHhMm).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  function hasProofInRange(
    paymentScreenshots: unknown,
    startMs: number | null,
    endMs: number | null
  ): boolean {
    const list = parseScreenshotEntries(paymentScreenshots);
    if (list.length === 0) return false;
    return list.some((x) => {
      if (!(x.url || x.waivedNoScreenshot)) return false;
      const t = x.uploadedAt?.toMillis?.();
      if (typeof t !== 'number') return false;
      if (startMs != null && t < startMs) return false;
      if (endMs != null && t > endMs) return false;
      return true;
    });
  }

  const scopedOrders = useMemo(() => {
    const pid = projectFilter.trim();
    const startMs = parseDateTimeMs(proofStart);
    const endMs = parseDateTimeMs(proofEnd);
    if (startMs != null && endMs != null && startMs > endMs) return [];
    return orders.filter((r) => {
      if (pid && r.data.projectId !== pid) return false;
      if (startMs == null && endMs == null) return true;
      return hasProofInRange(r.data.paymentScreenshots, startMs, endMs);
    });
  }, [orders, projectFilter, proofStart, proofEnd]);

  const pendingScopedOrders = useMemo(
    () => scopedOrders.filter((r) => r.data.status === 'pending'),
    [scopedOrders]
  );

  const handleBulkConfirmPending = async () => {
    if (!user) return;
    if (pendingScopedOrders.length === 0) {
      setErr('当前筛选范围内没有待确认订单。');
      return;
    }
    const pendingAmount = pendingScopedOrders.reduce(
      (s, r) => s + (r.data.totalAmount ?? 0),
      0
    );
    const ok = window.confirm(
      [
        `将确认当前筛选范围内 ${pendingScopedOrders.length} 笔待确认订单。`,
        `参考金额：${formatMYR(pendingAmount)}`,
        '请先确认与银行/收款渠道金额一致后再继续。',
      ].join('\n')
    );
    if (!ok) return;

    setBulkBusy(true);
    setErr(null);
    let success = 0;
    let failed = 0;
    for (const row of pendingScopedOrders) {
      try {
        await merchantConfirmPayment(row.id, user.uid);
        success += 1;
      } catch {
        failed += 1;
      }
    }
    await refresh();
    if (failed > 0) {
      setErr(`批量确认完成：成功 ${success} 笔，失败 ${failed} 笔（请刷新后逐笔检查失败单）。`);
    } else {
      setErr(`批量确认完成：成功 ${success} 笔。`);
    }
    setBulkBusy(false);
  };

  const totals = useMemo(
    () => buildReconciliationTotals(scopedOrders),
    [scopedOrders]
  );
  const unpaidMergedAmount = totals.unpaidAmount + totals.partialPaidPendingAmount;
  const unpaidMergedCount = totals.unpaidCount + totals.partialPaidCount;
  const fullCaliberAmount =
    totals.confirmedAmount +
    totals.pendingAmount +
    unpaidMergedAmount;
  const fullCaliberDiff = totals.totalActiveAmount - fullCaliberAmount;

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
      {err ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {err}
        </p>
      ) : null}

      <p className="mb-4 text-xs text-gray-600">
        汇总口径与 docs/04 一致：已确认到账、待确认、待付款；可与 TNG / DuitNow /
        银行等收款明细逐笔核对。
      </p>

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-3">
        <label className="block text-sm text-gray-800">
          筛选项目
          <select
            className="mt-1 block w-full max-w-md rounded-lg border border-gray-200 px-3 py-2 text-sm"
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
        <div className="mt-3 grid max-w-md gap-2 sm:grid-cols-2">
          <label className="block text-sm text-gray-800">
            凭证时间起（精确到分钟）
            <input
              type="datetime-local"
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={proofStart}
              onChange={(e) => {
                const v = e.target.value;
                const next = new URLSearchParams(searchParams);
                if (v) next.set('proofStart', v);
                else next.delete('proofStart');
                setSearchParams(next);
              }}
            />
          </label>
          <label className="block text-sm text-gray-800">
            凭证时间止（精确到分钟）
            <input
              type="datetime-local"
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={proofEnd}
              onChange={(e) => {
                const v = e.target.value;
                const next = new URLSearchParams(searchParams);
                if (v) next.set('proofEnd', v);
                else next.delete('proofEnd');
                setSearchParams(next);
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          时间筛选按「付款凭证提交时间」统计，包含顾客上传截图与商户免提交凭证。若要表示“5月4日24:00”，请填写次日 00:00。
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="text-xs font-medium text-emerald-800">已确认到账</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
            {formatMYR(totals.confirmedAmount)}
          </div>
          <div className="text-xs text-emerald-800">{totals.confirmedCount} 单</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="text-xs font-medium text-amber-900">待确认金额</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-amber-950">
            {formatMYR(totals.pendingAmount)}
          </div>
          <div className="text-xs text-amber-900">{totals.pendingCount} 单</div>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <div className="text-xs font-medium text-red-900">待付款</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-red-950">
            {formatMYR(unpaidMergedAmount)}
          </div>
          <div className="text-xs text-red-900">{unpaidMergedCount} 单</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-xs font-medium text-gray-700">订单总额（未取消）</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-gray-900">
            {formatMYR(totals.totalActiveAmount)}
          </div>
          <div className="text-xs text-gray-600">{totals.activeCount} 单</div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm">
        <div className="font-medium">全口径核对</div>
        <p className="mt-1 tabular-nums">
          已确认 + 待确认 + 待付款 = {formatMYR(fullCaliberAmount)}
        </p>
        <p className="mt-1 tabular-nums text-xs text-gray-600">
          与订单总额差值：{formatMYR(fullCaliberDiff)}
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
        <div className="font-medium">声称已付（业务侧）</div>
        <div className="mt-1 tabular-nums">
          {formatMYR(totals.claimedPaidAmount)} · {totals.claimedPaidCount} 单
        </div>
        <p className="mt-1 text-xs text-indigo-900/90">
          含已上传截图或状态为待确认/已确认/部分付款的订单，便于与通道侧「客户声称已付」对照。
        </p>
      </div>

      {totals.effectiveRatePercent != null ? (
        <p className="mb-4 text-sm text-gray-700">
          有效订单率（已确认单数 / 未取消单数）：
          <strong>{totals.effectiveRatePercent}%</strong>
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <ActionButton type="button" variant="primary" onClick={() => void handleCopy()}>
          {copyOk ? '已复制' : '复制对账清单'}
        </ActionButton>
        <ActionButton type="button" variant="secondary" onClick={handleExportCsv}>
          导出 CSV
        </ActionButton>
        <ActionButton
          type="button"
          variant="primary"
          disabled={bulkBusy || pendingScopedOrders.length === 0}
          onClick={() => void handleBulkConfirmPending()}
        >
          {bulkBusy
            ? '批量确认中…'
            : `一键确认待确认（${pendingScopedOrders.length}）`}
        </ActionButton>
      </div>

      {sortedRows.length === 0 ? (
        <EmptyStateCard
          title="当前筛选范围暂无订单"
          hint="可放宽时间窗口或切换项目查看。"
        />
      ) : (
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
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
              const hasShot = orderHasPaymentProof(o.paymentScreenshots);
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
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusChip
                      tone={toChipTone(o.status)}
                      label={statusLabel(o.status)}
                    />
                  </td>
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
      )}

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
