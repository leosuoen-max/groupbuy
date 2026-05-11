import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { ActionButton } from '../../components/ui/ActionButton';
import { EmptyStateCard } from '../../components/ui/EmptyStateCard';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  DEFAULT_BUCKET_SELECTION,
  buildDeliveryPointLookup,
  deliveryPointReconciliationLabel,
  proofRiskDisplayTone,
  linesInSelectedBuckets,
  listOrderPaymentGroups,
  orderMatchesBucketSelection,
  orderNeedsMissingProofLabel,
  scopedGroupAmount,
  type BucketSelection,
  type GroupBucket,
} from '../../lib/reconciliationGroups';
import {
  buildReconciliationCopyText,
  buildReconciliationCsv,
  buildReconciliationTotals,
  buildProductionCopyText,
  buildProductionCsv,
  buildProductionTotals,
} from '../../lib/reconciliationSummary';
import {
  buildProfitCopyText,
  buildProfitCsv,
  buildProfitTotals,
} from '../../lib/reconciliationProfit';
import { getProject } from '../../lib/projectService';
import type { ProjectDoc } from '../../types/firestore';
import { parseScreenshotEntries } from '../../lib/paymentScreenshotHelpers';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
import {
  listDeliveryPointsByOwnerId,
  type DeliveryPointRow,
} from '../../lib/deliveryPointService';
import { getShopBySlug } from '../../lib/shopService';
import type { OrderLineDoc, OrderStatus } from '../../types/firestore';

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

function formatLinesCell(lines: OrderLineDoc[], mode: 'all' | 'first'): string {
  if (lines.length === 0) return '—';
  if (mode === 'first') {
    const f = lines[0]!;
    return lines.length > 1
      ? `${f.name}×${f.quantity} 等${lines.length}项`
      : `${f.name}×${f.quantity}`;
  }
  return lines.map((l) => `${l.name}×${l.quantity}`).join('、');
}

function splitDpLabel(label: string): { code: string; name: string } {
  const raw = label.trim();
  const m = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (m) {
    return {
      code: m[1]?.trim() ?? '',
      name: m[2]?.trim() ?? '',
    };
  }
  return { code: '', name: raw };
}

export default function ReconciliationStatement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') ?? '';
  const proofStart = searchParams.get('proofStart') ?? '';
  const proofEnd = searchParams.get('proofEnd') ?? '';

  const [err, setErr] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPointRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyOk, setCopyOk] = useState(false);
  const [bucketSelection, setBucketSelection] = useState<BucketSelection>(
    () => ({ ...DEFAULT_BUCKET_SELECTION })
  );
  const [lineMode, setLineMode] = useState<'all' | 'first'>('first');
  const [viewMode, setViewMode] = useState<
    'reconciliation' | 'production' | 'profit'
  >('reconciliation');
  const [projectDocsMap, setProjectDocsMap] = useState<
    Map<string, ProjectDoc>
  >(() => new Map());

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setOrders([]);
        setErr('未找到该商户链接');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setOrders([]);
        setErr('无权限访问该商户');
        return;
      }
      setShopName(shop.data.name);
      const [orderRows, dpRows] = await Promise.all([
        listOrdersByShopId(shop.id),
        listDeliveryPointsByOwnerId(shop.data.ownerId, {
          fallbackShopId: shop.id,
          includeInactive: true,
        }).catch(() => [] as DeliveryPointRow[]),
      ]);
      setOrders(orderRows);
      setDeliveryPoints(dpRows);
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

  const deliveryPointLookup = useMemo(
    () => buildDeliveryPointLookup(deliveryPoints),
    [deliveryPoints]
  );

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

  const totals = useMemo(
    () => buildReconciliationTotals(scopedOrders),
    [scopedOrders]
  );
  const productionTotals = useMemo(
    () => buildProductionTotals(scopedOrders, bucketSelection),
    [scopedOrders, bucketSelection]
  );

  const projectIdsKey = useMemo(
    () =>
      [...new Set(scopedOrders.map((r) => r.data.projectId))]
        .sort()
        .join(','),
    [scopedOrders]
  );

  useEffect(() => {
    let cancelled = false;
    const ids = projectIdsKey
      ? (projectIdsKey.split(',') as string[])
      : [];
    if (ids.length === 0) {
      setProjectDocsMap(new Map());
      return;
    }
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          const row = await getProject(id);
          return [id, row?.data ?? null] as const;
        })
      );
      if (cancelled) return;
      const m = new Map<string, ProjectDoc>();
      for (const [id, data] of entries) {
        if (data) m.set(id, data);
      }
      setProjectDocsMap(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectIdsKey]);

  const profitTotals = useMemo(
    () => buildProfitTotals(scopedOrders, bucketSelection, projectDocsMap),
    [scopedOrders, bucketSelection, projectDocsMap]
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

  const tableRows = useMemo(() => {
    type Row = {
      row: OrderRow;
      groups: ReturnType<typeof listOrderPaymentGroups>;
      dp: string;
      scopedAmt: number;
    };
    const acc: Row[] = [];
    for (const r of scopedOrders) {
      if (r.data.status === 'cancelled') continue;
      const groups = listOrderPaymentGroups(r.data);
      if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;
      acc.push({
        row: r,
        groups,
        dp: deliveryPointReconciliationLabel(r.data, deliveryPointLookup),
        scopedAmt: scopedGroupAmount(groups, bucketSelection),
      });
    }
    acc.sort((a, b) => {
      const c = a.dp.localeCompare(b.dp, 'zh-CN');
      if (c !== 0) return c;
      const ta = a.row.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.row.data.createdAt?.toMillis?.() ?? 0;
      return ta - tb;
    });
    return acc;
  }, [scopedOrders, bucketSelection, deliveryPointLookup]);

  const sectionsByDp = useMemo(() => {
    const m = new Map<string, typeof tableRows>();
    for (const item of tableRows) {
      if (!m.has(item.dp)) m.set(item.dp, []);
      m.get(item.dp)!.push(item);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }, [tableRows]);

  const handleCopy = async () => {
    const text =
      viewMode === 'reconciliation'
        ? buildReconciliationCopyText({
            shopName,
            projectLabel,
            rows: scopedOrders,
            totals,
            bucketSelection,
            deliveryPointLookup,
          })
        : viewMode === 'production'
          ? buildProductionCopyText({
              shopName,
              projectLabel,
              totals: productionTotals,
            })
          : buildProfitCopyText({
              shopName,
              projectLabel,
              totals: profitTotals,
            });
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setCopyOk(false);
    }
  };

  const bucketFileSuffix = useMemo(() => {
    const parts: string[] = [];
    if (bucketSelection.confirmed) parts.push('已确认');
    if (bucketSelection.pending) parts.push('待确认');
    if (bucketSelection.unpaid) parts.push('待付款');
    return parts.join('+') || '无';
  }, [bucketSelection]);

  const handleExportCsv = () => {
    const csv = '\ufeff' + (
      viewMode === 'reconciliation'
        ? buildReconciliationCsv(scopedOrders, bucketSelection, deliveryPointLookup)
        : viewMode === 'production'
          ? buildProductionCsv(productionTotals)
          : buildProfitCsv(profitTotals)
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      viewMode === 'reconciliation'
        ? `对账单-${slug}-${projectFilter || 'all'}-${bucketFileSuffix}.csv`
        : viewMode === 'production'
          ? `生产统计-${slug}-${projectFilter || 'all'}-${bucketFileSuffix}.csv`
          : `成本利润-${slug}-${projectFilter || 'all'}-${bucketFileSuffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function toggleBucket(k: GroupBucket) {
    setBucketSelection((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      if (!next.confirmed && !next.pending && !next.unpaid) {
        return prev;
      }
      return next;
    });
  }

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
          返回后台入口
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
        清单按「付款组」统计金额（首单 / 加购各一档）；汇总卡片为当前项目与时间筛选下的全量组口径，清单可通过下方标签筛选包含哪些组。
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-700">视图：</span>
        <button
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            viewMode === 'reconciliation'
              ? 'bg-gray-900 text-white'
              : 'border border-gray-200 bg-white text-gray-600'
          }`}
          onClick={() => setViewMode('reconciliation')}
        >
          金额对账
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            viewMode === 'production'
              ? 'bg-gray-900 text-white'
              : 'border border-gray-200 bg-white text-gray-600'
          }`}
          onClick={() => setViewMode('production')}
        >
          厨房生产统计
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            viewMode === 'profit'
              ? 'bg-gray-900 text-white'
              : 'border border-gray-200 bg-white text-gray-600'
          }`}
          onClick={() => setViewMode('profit')}
        >
          成本利润统计
        </button>
      </div>

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

      {viewMode === 'reconciliation' ? (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <div className="text-xs font-medium text-emerald-800">已确认到账（组口径）</div>
              <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums text-emerald-900">
                {formatMYR(totals.confirmedAmount)}
              </div>
              <div className="text-xs text-emerald-800">{totals.confirmedCount} 单</div>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <div className="text-xs font-medium text-amber-900">待确认金额（组口径）</div>
              <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums text-amber-950">
                {formatMYR(totals.pendingAmount)}
              </div>
              <div className="text-xs text-amber-900">{totals.pendingCount} 单</div>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
              <div className="text-xs font-medium text-red-900">待付款（组口径）</div>
              <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums text-red-950">
                {formatMYR(totals.unpaidAmount)}
              </div>
              <div className="text-xs text-red-900">{totals.unpaidCount} 单</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-medium text-gray-700">订单总额（未取消）</div>
              <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums text-gray-900">
                {formatMYR(totals.totalActiveAmount)}
              </div>
              <div className="text-xs text-gray-600">{totals.activeCount} 单</div>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
            <div className="font-medium">已确认构成（组口径）</div>
            <div className="mt-2 space-y-1.5 tabular-nums">
              <p className="flex items-center justify-between gap-3">
                <span className="text-indigo-900/90">钱包支付金额</span>
                <strong className="text-base text-indigo-950">
                  {formatMYR(totals.confirmedWalletAmount)}
                </strong>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-indigo-900/90">次卡代扣金额</span>
                <strong className="text-base text-indigo-950">
                  {formatMYR(totals.confirmedPassDeductAmount)}
                </strong>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-indigo-900/90">免凭证金额</span>
                <strong className="text-base text-indigo-950">
                  {formatMYR(totals.confirmedWaivedNoProofAmount)}
                </strong>
              </p>
            </div>
            <p className="mt-2 text-xs text-indigo-900/80">
              仅统计已确认组中的钱包/次卡/商户免凭证三类构成。
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
              有效订单率（订单状态已确认 / 未取消单数）：
              <strong>{totals.effectiveRatePercent}%</strong>
            </p>
          ) : null}
        </>
      ) : viewMode === 'production' ? (
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <div className="text-xs font-medium text-indigo-800">总出品份数</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">
              {productionTotals.totalQty}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <div className="text-xs font-medium text-emerald-800">普通商品总份数</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">
              {productionTotals.normalTotalQty}
            </div>
          </div>
          <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3">
            <div className="text-xs font-medium text-purple-800">套餐拆解总份数</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-purple-950">
              {productionTotals.bundleOptionTotalQty}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-5 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex min-h-[5.5rem] flex-col rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <div className="text-xs font-medium leading-tight text-emerald-800">
                <span className="block">销售额</span>
                <span className="mt-0.5 block text-[10px] font-normal text-emerald-800/90">
                  行 subtotal
                </span>
              </div>
              <div className="mt-auto whitespace-nowrap pt-1 text-xl font-bold tabular-nums text-emerald-950">
                {formatMYR(profitTotals.totalSales)}
              </div>
            </div>
            <div className="flex min-h-[5.5rem] flex-col rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <div className="text-xs font-medium text-amber-900">采购成本</div>
              <div className="mt-auto whitespace-nowrap pt-1 text-xl font-bold tabular-nums text-amber-950">
                {formatMYR(profitTotals.totalCost)}
              </div>
            </div>
            <div className="flex min-h-[5.5rem] flex-col rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
              <div className="text-xs font-medium text-indigo-800">毛利</div>
              <div className="mt-auto whitespace-nowrap pt-1 text-xl font-bold tabular-nums text-indigo-950">
                {formatMYR(profitTotals.grossProfit)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex min-h-[5.5rem] flex-col rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
              <div className="text-xs font-medium text-rose-900">早鸟让价合计</div>
              <div className="mt-1 whitespace-nowrap text-lg font-bold tabular-nums text-rose-950">
                {formatMYR(profitTotals.earlyBirdReduction)}
              </div>
              <p className="mt-auto pt-2 text-[11px] leading-snug text-rose-900/80">
                相对当前菜单标价 × 份数（限时截止）
              </p>
            </div>
            <div className="flex min-h-[5.5rem] flex-col rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
              <div className="text-xs font-medium text-orange-900">特惠让价合计</div>
              <div className="mt-1 whitespace-nowrap text-lg font-bold tabular-nums text-orange-950">
                {formatMYR(profitTotals.specialReduction)}
              </div>
              <p className="mt-auto pt-2 text-[11px] leading-snug text-orange-900/80">
                相对当前菜单标价 × 份数（无截止）
              </p>
            </div>
            <div className="flex min-h-[5.5rem] flex-col rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-medium text-gray-800">优惠让价总计</div>
              <div className="mt-auto whitespace-nowrap pt-1 text-lg font-bold tabular-nums text-gray-900">
                {formatMYR(profitTotals.discountReductionTotal)}
              </div>
            </div>
          </div>
          <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
            利润统计复用上方「筛选项目」「凭证时间」与「清单包含」所选付款组（含待付款、待确认、已确认）。
            请在项目编辑中为商品与套餐方案填写<strong className="font-medium text-gray-800">采购成本</strong>
            ；未填则该行成本按 0，并在下方表格旁提示缺失笔数。
            早鸟/特惠让价按<strong className="font-medium text-gray-800">当前菜单标价</strong>
            推算；若改价与下单时不一致会有误差。
          </p>
          {profitTotals.missingProjectCount > 0 ? (
            <p className="text-xs text-amber-800">
              有 {profitTotals.missingProjectCount} 笔订单未能加载项目菜单（无法拆分成本/让价）。
            </p>
          ) : null}
          {profitTotals.missingCostLineCount > 0 ? (
            <p className="text-xs text-amber-800">
              有 {profitTotals.missingCostLineCount}{' '}
              条明细未配置采购成本（已计入销售额，成本按 0）。
            </p>
          ) : null}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-700">清单包含：</span>
        {(
          [
            ['confirmed', '已确认组'] as const,
            ['pending', '待确认组'] as const,
            ['unpaid', '待付款组'] as const,
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              bucketSelection[k]
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-600'
            }`}
            onClick={() => toggleBucket(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {viewMode === 'reconciliation' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-700">商品展示：</span>
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              lineMode === 'first'
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-600'
            }`}
            onClick={() => setLineMode('first')}
          >
            仅首行
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              lineMode === 'all'
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-600'
            }`}
            onClick={() => setLineMode('all')}
          >
            全部行
          </button>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap gap-2">
        <ActionButton type="button" variant="primary" onClick={() => void handleCopy()}>
          {copyOk
            ? '已复制'
            : viewMode === 'reconciliation'
              ? '复制对账清单'
              : viewMode === 'production'
                ? '复制生产清单'
                : '复制利润统计'}
        </ActionButton>
        <ActionButton type="button" variant="secondary" onClick={handleExportCsv}>
          导出 CSV
        </ActionButton>
      </div>
      {viewMode === 'reconciliation' ? (
        <p className="mb-4 text-xs text-gray-500">
          配送点列优先展示<strong className="font-medium text-gray-700">编号 + 简称</strong>
          （与配送点管理一致）；无绑定 ID 的历史订单仍显示收货时的快照名称。手机宽度有限时可<strong className="font-medium text-gray-700">左右滑动</strong>
          查看整表。
        </p>
      ) : viewMode === 'production' ? (
        <p className="mb-4 text-xs text-gray-500">
          生产统计复用当前项目、凭证时间与「清单包含」筛选。普通商品按下单份数累计；套餐按系列中具体单项拆解累计，供厨房备料与出品参考。
        </p>
      ) : (
        <p className="mb-4 text-xs text-gray-500">
          按商品/套餐方案汇总销售额、采购成本与毛利；「优惠减免」为特惠/早鸟等相对<strong className="font-medium text-gray-700">当前菜单标价</strong>
          的抵扣合计（与上方让价卡片口径一致）。筛选范围与「清单包含」一致，可包含待付款、待确认组。
        </p>
      )}

      {viewMode === 'reconciliation' && tableRows.length === 0 ? (
        <EmptyStateCard
          title="当前筛选范围暂无订单"
          hint="可放宽时间窗口、切换项目，或勾选更多「清单包含」标签。"
        />
      ) : viewMode === 'profit' && profitTotals.rows.length === 0 ? (
        <EmptyStateCard
          title="当前筛选下无明细"
          hint="请勾选「清单包含」中的付款组，或放宽项目/时间筛选。"
        />
      ) : viewMode === 'reconciliation' ? (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[42rem] table-fixed border-collapse text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-700">
              <tr>
                <th className="w-[17%] px-2 py-2">配送点</th>
                <th className="w-[14%] px-2 py-2">时间</th>
                <th className="w-[14%] px-2 py-2">付款方</th>
                <th className="w-[10%] px-2 py-2">订单</th>
                <th className="w-[23%] px-2 py-2">内容</th>
                <th className="w-[10%] px-2 py-2">清单金额</th>
                <th className="w-[8%] px-2 py-2">状态</th>
                <th className="w-[4%] px-2 py-2 text-center">凭证</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sectionsByDp.map(([dpLabel, items]) => (
                <Fragment key={dpLabel}>
                  <tr className="bg-gray-100/90">
                    <td colSpan={8} className="px-2 py-2 text-xs font-semibold leading-snug text-gray-800">
                      {(() => {
                        const { code, name } = splitDpLabel(dpLabel);
                        if (!code) return <span className="break-words">{name}</span>;
                        return (
                          <span className="inline-flex flex-col leading-tight">
                            <span className="font-extrabold text-gray-900">{code}</span>
                            <span className="break-words">{name}</span>
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                  {items.map(({ row, groups, scopedAmt, dp }) => {
                    const o = row.data;
                    const d = o.createdAt?.toDate?.();
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const dateStr = d
                      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
                      : '—';
                    const clockStr = d
                      ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
                      : '—';
                    const scopedLines = linesInSelectedBuckets(groups, bucketSelection);
                    const contentStr = formatLinesCell(scopedLines, lineMode);
                    const detailUrl = `${baseDash}/order/${encodeURIComponent(o.projectId)}/${encodeURIComponent(o.orderNumber)}`;
                    const missingProof = orderNeedsMissingProofLabel(o);
                    const flag = proofRiskDisplayTone(o);
                    const dpParts = splitDpLabel(dp);
                    return (
                      <tr
                        key={row.id}
                        role="link"
                        tabIndex={0}
                        className="cursor-pointer bg-white hover:bg-indigo-50/40"
                        onClick={() => navigate(detailUrl)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(detailUrl);
                          }
                        }}
                      >
                        <td className="w-[17%] align-top px-2 py-2 text-[11px] leading-tight text-gray-700" title={dp}>
                          {dpParts.code ? (
                            <span className="inline-flex flex-col">
                              <span className="font-extrabold text-gray-900">{dpParts.code}</span>
                              <span className="line-clamp-1 break-words">{dpParts.name}</span>
                            </span>
                          ) : (
                            <span className="line-clamp-2 break-words">{dpParts.name}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 align-top text-xs tabular-nums leading-tight text-gray-700">
                          <span className="inline-flex flex-col">
                            <span>{dateStr}</span>
                            <span>{clockStr}</span>
                          </span>
                        </td>
                        <td className="min-w-0 px-2 py-2 align-top break-words text-[13px] font-medium leading-snug text-gray-900">
                          {o.customerName?.trim() || '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 align-top font-mono text-[11px] text-indigo-700 underline-offset-2">
                          {o.orderNumber}
                        </td>
                        <td
                          className="min-w-0 px-2 py-2 align-top text-[13px] text-gray-700"
                          title={contentStr}
                        >
                          <span className="line-clamp-2 break-words">{contentStr}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 align-top tabular-nums text-sm font-medium">
                          {formatMYR(scopedAmt)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 align-top">
                          <StatusChip
                            tone={toChipTone(o.status)}
                            label={statusLabel(o.status)}
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 align-top text-xs text-center">
                          {missingProof ? (
                            <span className="inline-flex flex-col items-center justify-center font-medium leading-tight text-amber-900">
                              <span>缺少</span>
                              <span>凭证</span>
                            </span>
                          ) : (
                            <span className="inline-flex w-full items-center justify-center">
                              <span
                                className={`inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-white/80 ${
                                  flag === 'red'
                                    ? 'bg-red-500'
                                    : flag === 'yellow'
                                      ? 'bg-amber-400'
                                      : 'bg-emerald-500'
                                }`}
                                title={
                                  flag === 'red'
                                    ? '红旗'
                                    : flag === 'yellow'
                                      ? '黄旗'
                                      : '绿旗'
                                }
                              />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : viewMode === 'production' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                普通商品（{productionTotals.normalItems.length} 种）
              </h3>
            </div>
            {productionTotals.normalItems.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">暂无普通商品。</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {productionTotals.normalItems.map((row) => (
                  <li key={row.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 break-words text-sm text-gray-800">{row.name}</span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-gray-900">
                      × {row.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                套餐拆解（{productionTotals.bundleOptionItems.length} 项）
              </h3>
            </div>
            {productionTotals.bundleOptionItems.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">暂无套餐拆解项。</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {productionTotals.bundleOptionItems.map((row) => (
                  <li key={row.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 break-words text-sm text-gray-800">{row.name}</span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-gray-900">
                      × {row.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[42rem] table-fixed border-collapse text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-700">
              <tr>
                <th className="w-[12%] px-2 py-2">类型</th>
                <th className="w-[22%] px-2 py-2">名称</th>
                <th className="w-[8%] px-2 py-2">数量</th>
                <th className="w-[13%] px-2 py-2">销售额</th>
                <th className="w-[13%] px-2 py-2">成本</th>
                <th className="w-[13%] px-2 py-2">毛利</th>
                <th className="w-[13%] px-2 py-2">优惠减免</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profitTotals.rows.map((r) => (
                <tr key={r.key} className="bg-white">
                  <td className="px-2 py-2 text-xs text-gray-600">
                    {r.kind === 'scheme' ? '套餐方案' : '商品'}
                  </td>
                  <td className="min-w-0 px-2 py-2 break-words text-gray-900">{r.name}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{r.quantity}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                    {formatMYR(r.sales)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                    {formatMYR(r.cost)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-medium tabular-nums text-emerald-900">
                    {formatMYR(r.profit)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-amber-900">
                    {formatMYR(r.discountReduction)}
                  </td>
                </tr>
              ))}
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
