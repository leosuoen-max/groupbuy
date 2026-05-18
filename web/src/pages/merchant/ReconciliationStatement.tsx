import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProofDatetimeFilterFields } from '../../components/reconciliation/ProofDatetimeFilterFields';
import { ProductionBundleBreakdownSection } from '../../components/reconciliation/ProductionBundleBreakdownSection';
import { ProductionSummaryStatsBar } from '../../components/reconciliation/ProductionSummaryStatsBar';
import { PageShell } from '../../components/PageShell';
import { ActionButton } from '../../components/ui/ActionButton';
import { EmptyStateCard } from '../../components/ui/EmptyStateCard';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAuthUser } from '../../hooks/useAuthUser';
import { useMerchantShopAccess } from '../../hooks/useMerchantShopAccess';
import { formatMYR } from '../../lib/formatMYR';
import {
  DEFAULT_BUCKET_SELECTION,
  PRODUCTION_DEFAULT_BUCKET_SELECTION,
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
  buildProductionCopyText,
  buildProductionCsv,
  buildProductionTotals,
} from '../../lib/reconciliationSummary';
import {
  buildProfitCopyText,
  buildProfitCsv,
  buildProfitTotals,
} from '../../lib/reconciliationProfit';
import {
  buildDeliveryDetailCsv,
  buildDeliveryManifest,
  buildDeliveryManifestCopyText,
  buildDeliveryManifestCsv,
  buildMerchantDeliveryPointMap,
  listDeliverySlotOptionsFromOrders,
  orderMatchesDeliverySlotKey,
  OTHER_DELIVERY_ZONE_KEY,
  resolveDeliveryPointGroup,
  type DeliveryPointGroup,
  type DeliveryReconciliationScope,
} from '../../lib/feituanDeliveryReconciliation';
import { listOrderCardPaymentApplications } from '../../lib/orderCardPaymentApplications';
import { getProject } from '../../lib/projectService';
import type { ProjectDoc } from '../../types/firestore';
import { parseScreenshotEntries } from '../../lib/paymentScreenshotHelpers';
import {
  listOrdersByShopId,
  merchantAssignManualDeliveryMatch,
  type OrderRow,
} from '../../lib/orderService';
import {
  listDeliveryPointsByOwnerId,
  type DeliveryPointRow,
} from '../../lib/deliveryPointService';
import type { OrderDoc, OrderLineDoc, OrderStatus } from '../../types/firestore';

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

function stripManualDispatchPrefix(text: string): string {
  return text
    .replace(/^其他[（(]将按地址手动匹配[）)]\s*[:：]\s*/u, '')
    .trim();
}

function manualOrderAddressDisplay(o: OrderDoc): string {
  const addr = o.customerAddress?.trim();
  if (addr) return addr;
  const snap = o.deliveryPointSnapshot?.name?.trim() ?? '';
  const stripped = stripManualDispatchPrefix(snap);
  return stripped || snap || '—';
}

type DeliveryTableItem = {
  row: OrderRow;
  groups: ReturnType<typeof listOrderPaymentGroups>;
  dp: DeliveryPointGroup;
  scopedAmt: number;
};

function formatOrderTime(o: OrderDoc): { dateStr: string; clockStr: string } {
  const d = o.createdAt?.toDate?.();
  if (!d) return { dateStr: '—', clockStr: '—' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateStr: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    clockStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function inRange(t: number | undefined, startMs: number | null, endMs: number | null): boolean {
  if (typeof t !== 'number') return false;
  if (startMs != null && t < startMs) return false;
  if (endMs != null && t > endMs) return false;
  return true;
}

function hasPaymentActivityInRange(
  order: OrderDoc,
  startMs: number | null,
  endMs: number | null
): boolean {
  const proofs = parseScreenshotEntries(order.paymentScreenshots);
  if (
    proofs.some(
      (x) =>
        Boolean(x.url || x.waivedNoScreenshot) &&
        inRange(x.uploadedAt?.toMillis?.(), startMs, endMs)
    )
  ) {
    return true;
  }
  return listOrderCardPaymentApplications(order).some((x) =>
    inRange(x.appliedAt?.toMillis?.(), startMs, endMs)
  );
}

export default function ReconciliationStatement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const m = useMerchantShopAccess(shopSlug);
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') ?? '';
  const proofStart = searchParams.get('proofStart') ?? '';
  const proofEnd = searchParams.get('proofEnd') ?? '';
  const deliverySlotKey = searchParams.get('deliverySlot') ?? '';

  const [err, setErr] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPointRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyOk, setCopyOk] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualModalItems, setManualModalItems] = useState<DeliveryTableItem[]>(
    []
  );
  const [manualModalBusyId, setManualModalBusyId] = useState<string | null>(null);
  const [manualModalErr, setManualModalErr] = useState<string | null>(null);
  const [manualDpChoice, setManualDpChoice] = useState<Record<string, string>>({});
  const [bucketSelection, setBucketSelection] = useState<BucketSelection>(
    () => ({ ...DEFAULT_BUCKET_SELECTION })
  );
  const [productionBucketSelection, setProductionBucketSelection] =
    useState<BucketSelection>(() => ({ ...PRODUCTION_DEFAULT_BUCKET_SELECTION }));
  const [lineMode, setLineMode] = useState<'all' | 'first'>('first');
  const [viewMode, setViewMode] = useState<'delivery' | 'production' | 'profit'>(
    'delivery'
  );
  const [projectDocsMap, setProjectDocsMap] = useState<
    Map<string, ProjectDoc>
  >(() => new Map());

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      if (!m.shop) {
        setOrders([]);
        setErr(m.bootErr ?? '未找到该商户链接');
        return;
      }
      if (!m.canOrdersOrReconciliation) {
        setOrders([]);
        setErr('无权限访问该商户');
        return;
      }
      setShopName(m.shop.data.name);
      const [orderRows, dpRows] = await Promise.all([
        listOrdersByShopId(m.shop.id),
        listDeliveryPointsByOwnerId(m.shop.data.ownerId, {
          fallbackShopId: m.shop.id,
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
  }, [m.bootErr, m.canOrdersOrReconciliation, m.shop, user]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!authLoading && !m.loading && user) void refresh();
      else if (!authLoading && !user) setLoading(false);
    });
  }, [authLoading, m.loading, refresh, user]);

  function parseDateTimeMs(yyyyMmDdHhMm: string): number | null {
    if (!yyyyMmDdHhMm.trim()) return null;
    const ms = new Date(yyyyMmDdHhMm).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  const merchantPointById = useMemo(
    () => buildMerchantDeliveryPointMap(deliveryPoints),
    [deliveryPoints]
  );

  const deliveryScope = useMemo((): DeliveryReconciliationScope => {
    const shopId = m.shop?.id?.trim();
    return {
      ...(shopId ? { shopZoneKey: `shop:${shopId}` } : {}),
      ...(shopName.trim() ? { shopZoneName: shopName.trim() } : {}),
    };
  }, [m.shop?.id, shopName]);

  const projectScopedOrders = useMemo(() => {
    const pid = projectFilter.trim();
    return orders.filter((r) => !pid || r.data.projectId === pid);
  }, [orders, projectFilter]);

  const scopedOrders = useMemo(() => {
    const startMs = parseDateTimeMs(proofStart);
    const endMs = parseDateTimeMs(proofEnd);
    if (startMs != null && endMs != null && startMs > endMs) return [];
    return projectScopedOrders.filter((r) => {
      if (startMs == null && endMs == null) return true;
      return hasPaymentActivityInRange(r.data, startMs, endMs);
    });
  }, [projectScopedOrders, proofEnd, proofStart]);

  const deliverySlotOptions = useMemo(
    () => listDeliverySlotOptionsFromOrders(projectScopedOrders),
    [projectScopedOrders]
  );

  const selectedSlotLabel =
    deliverySlotOptions.find((x) => x.key === deliverySlotKey)?.label ??
    deliverySlotKey;

  const deliveryScopedOrders = useMemo(() => {
    if (!deliverySlotKey.trim()) return [];
    return projectScopedOrders.filter(
      (r) =>
        r.data.status !== 'cancelled' &&
        orderMatchesDeliverySlotKey(r.data, deliverySlotKey)
    );
  }, [deliverySlotKey, projectScopedOrders]);

  const deliveryManifest = useMemo(
    () =>
      buildDeliveryManifest(
        deliveryScopedOrders,
        bucketSelection,
        merchantPointById,
        deliveryScope
      ),
    [bucketSelection, deliveryScopedOrders, deliveryScope, merchantPointById]
  );
  const productionTotals = useMemo(
    () =>
      buildProductionTotals(
        deliveryScopedOrders,
        productionBucketSelection,
        projectDocsMap
      ),
    [deliveryScopedOrders, productionBucketSelection, projectDocsMap]
  );

  const projectIdsKey = useMemo(() => {
    const source =
      viewMode === 'production' ? deliveryScopedOrders : scopedOrders;
    return [...new Set(source.map((r) => r.data.projectId))].sort().join(',');
  }, [deliveryScopedOrders, scopedOrders, viewMode]);

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

  const deliveryTableRows = useMemo(() => {
    if (!deliverySlotKey.trim()) return [];
    const acc: DeliveryTableItem[] = [];
    for (const r of deliveryScopedOrders) {
      const groups = listOrderPaymentGroups(r.data);
      if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;
      acc.push({
        row: r,
        groups,
        dp: resolveDeliveryPointGroup(r.data, merchantPointById, deliveryScope),
        scopedAmt: scopedGroupAmount(groups, bucketSelection),
      });
    }
    acc.sort((a, b) => {
      const c = a.dp.sortKey.localeCompare(b.dp.sortKey, 'zh-CN');
      if (c !== 0) return c;
      const ta = a.row.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.row.data.createdAt?.toMillis?.() ?? 0;
      return ta - tb;
    });
    return acc;
  }, [
    bucketSelection,
    deliveryScopedOrders,
    deliveryScope,
    deliverySlotKey,
    merchantPointById,
  ]);

  const sectionsByDp = useMemo(() => {
    const m = new Map<string, DeliveryTableItem[]>();
    for (const item of deliveryTableRows) {
      const key = item.dp.sortKey;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(item);
    }
    return [...m.entries()].sort((a, b) => {
      const manualA = a[1][0]?.dp.zoneKey === OTHER_DELIVERY_ZONE_KEY;
      const manualB = b[1][0]?.dp.zoneKey === OTHER_DELIVERY_ZONE_KEY;
      if (manualA && !manualB) return 1;
      if (manualB && !manualA) return -1;
      return a[0].localeCompare(b[0], 'zh-CN');
    });
  }, [deliveryTableRows]);

  useEffect(() => {
    if (!deliverySlotKey.trim()) return;
    if (deliverySlotOptions.some((x) => x.key === deliverySlotKey)) return;
    const next = new URLSearchParams(searchParams);
    next.delete('deliverySlot');
    setSearchParams(next, { replace: true });
  }, [deliverySlotKey, deliverySlotOptions, searchParams, setSearchParams]);

  const handleCopy = async () => {
    const text =
      viewMode === 'delivery'
        ? buildDeliveryManifestCopyText({
            slotLabel: selectedSlotLabel || '未选配送档',
            projectLabel,
            zones: deliveryManifest,
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
    const sel =
      viewMode === 'production' ? productionBucketSelection : bucketSelection;
    const parts: string[] = [];
    if (sel.confirmed) parts.push('已确认');
    if (sel.pending) parts.push('待确认');
    if (sel.unpaid) parts.push('待付款');
    return parts.join('+') || '无';
  }, [bucketSelection, productionBucketSelection, viewMode]);

  const activeBucketSelection =
    viewMode === 'production' ? productionBucketSelection : bucketSelection;

  const handleExportCsv = () => {
    const csv = '\ufeff' + (
      viewMode === 'delivery'
        ? [
            buildDeliveryManifestCsv(deliveryManifest),
            '',
            buildDeliveryDetailCsv(
              deliveryScopedOrders,
              bucketSelection,
              merchantPointById,
              deliveryScope
            ),
          ].join('\n')
        : viewMode === 'production'
          ? buildProductionCsv(productionTotals)
          : buildProfitCsv(profitTotals)
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slotSuffix = deliverySlotKey.replace(':', '-') || '未选档';
    a.download =
      viewMode === 'delivery'
        ? `配送统计-${slug}-${projectFilter || 'all'}-${slotSuffix}-${bucketFileSuffix}.csv`
        : viewMode === 'production'
          ? `生产统计-${slug}-${projectFilter || 'all'}-${slotSuffix}-${bucketFileSuffix}.csv`
          : `财务统计-${slug}-${projectFilter || 'all'}-${bucketFileSuffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function toggleBucket(k: GroupBucket) {
    const setter =
      viewMode === 'production' ? setProductionBucketSelection : setBucketSelection;
    setter((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      if (!next.confirmed && !next.pending && !next.unpaid) {
        return prev;
      }
      return next;
    });
  }

  const baseDash = `/dashboard/${encodeURIComponent(slug)}`;

  const activeDeliveryPoints = useMemo(
    () => deliveryPoints.filter((p) => p.data.isActive !== false),
    [deliveryPoints]
  );

  const openManualMatchModal = useCallback((items: DeliveryTableItem[]) => {
    setManualModalErr(null);
    setManualDpChoice({});
    setManualModalItems(items);
    setManualModalOpen(true);
  }, []);

  const runManualAssign = useCallback(
    async (item: DeliveryTableItem, deliveryPointId: string | null) => {
      if (!user) return;
      setManualModalErr(null);
      setManualModalBusyId(item.row.id);
      try {
        await merchantAssignManualDeliveryMatch({
          orderFirestoreId: item.row.id,
          actorUserId: user.uid,
          deliveryPointId,
        });
        await refresh();
        setManualModalItems((prev) => {
          const next = prev.filter((x) => x.row.id !== item.row.id);
          if (next.length === 0) setManualModalOpen(false);
          return next;
        });
      } catch (e) {
        setManualModalErr(e instanceof Error ? e.message : '操作失败');
      } finally {
        setManualModalBusyId(null);
      }
    },
    [user, refresh]
  );

  if (authLoading || m.loading || (user && loading)) {
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
    <PageShell title="对账单" subtitle={`${shopName} · 本店订单配送与财务统计`}>
      {err ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {err}
        </p>
      ) : null}

      <p className="mb-4 text-xs text-gray-600">
        {viewMode === 'delivery'
          ? '配送统计按配送档汇总本店清单与明细；须先选择配送档。明细金额仍按支付组统计，可通过「清单包含」筛选。'
          : viewMode === 'production'
            ? '生产统计按项目与配送档筛选本店订单；须先选择配送档。清单包含默认仅「已确认组」，可手动勾选其他支付组。'
            : '财务统计按凭证时间与项目筛选本店订单；成本请在项目编辑中维护采购成本。'}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-700">视图：</span>
        <button
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            viewMode === 'delivery'
              ? 'bg-gray-900 text-white'
              : 'border border-gray-200 bg-white text-gray-600'
          }`}
          onClick={() => setViewMode('delivery')}
        >
          配送统计
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
          财务统计
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
        {viewMode === 'delivery' || viewMode === 'production' ? (
          <label className="mt-3 block text-sm text-gray-800">
            配送档
            <select
              className="mt-1 block w-full max-w-md rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={deliverySlotKey}
              onChange={(e) => {
                const v = e.target.value;
                const next = new URLSearchParams(searchParams);
                if (v) next.set('deliverySlot', v);
                else next.delete('deliverySlot');
                setSearchParams(next);
              }}
            >
              <option value="">请选择配送档</option>
              {deliverySlotOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              选项来自当前项目筛选下本店已有订单的配送档；无档订单不会出现在列表中。
            </span>
          </label>
        ) : (
          <ProofDatetimeFilterFields
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            proofStart={proofStart}
            proofEnd={proofEnd}
            startLabel="凭证时间起（精确到分钟）"
            endLabel="凭证时间止（精确到分钟）"
            hint="时间筛选按「付款凭证提交时间」统计，包含顾客上传截图与商户免提交凭证。若要表示「5月4日24:00」，请填写次日 00:00。"
          />
        )}
      </div>

      {viewMode === 'production' ? (
        <ProductionSummaryStatsBar totals={productionTotals} />
      ) : viewMode === 'profit' ? (
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
            财务统计复用上方「筛选项目」「凭证时间」与「清单包含」所选付款组（含待付款、待确认、已确认）。
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
      ) : null}

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
              activeBucketSelection[k]
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-600'
            }`}
            onClick={() => toggleBucket(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {viewMode === 'delivery' ? (
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
            : viewMode === 'delivery'
              ? '复制配送清单'
              : viewMode === 'production'
                ? '复制生产清单'
                : '复制财务统计'}
        </ActionButton>
        <ActionButton type="button" variant="secondary" onClick={handleExportCsv}>
          导出 CSV
        </ActionButton>
      </div>
      {viewMode === 'delivery' ? (
        <p className="mb-4 text-xs text-gray-500">
          本店配送点列上行：<strong className="font-medium text-gray-700">店铺名 + 编号</strong>
          （无配送区时归入本店），下行为配送点名称。无法匹配的 ID 归入「未知配送点」。明细可左右滑动查看。
        </p>
      ) : viewMode === 'production' ? (
        <p className="mb-4 text-xs text-gray-500">
          生产统计按当前项目、配送档与「清单包含」筛选。普通商品按下单份数累计；套餐按系列中具体单项拆解累计，供厨房备料与出品参考。
        </p>
      ) : (
        <p className="mb-4 text-xs text-gray-500">
          按商品/套餐方案汇总销售额、采购成本与毛利；「优惠减免」为特惠/早鸟等相对<strong className="font-medium text-gray-700">当前菜单标价</strong>
          的抵扣合计（与上方让价卡片口径一致）。筛选范围与「清单包含」一致，可包含待付款、待确认组。
        </p>
      )}

      {viewMode === 'delivery' && !deliverySlotKey ? (
        <EmptyStateCard
          title="请先选择配送档"
          hint="在上方选择配送档后，将显示本店配送清单与配送明细。"
        />
      ) : viewMode === 'delivery' &&
        deliveryTableRows.length === 0 &&
        deliveryManifest.length === 0 ? (
        <EmptyStateCard
          title="当前配送档暂无订单"
          hint="可切换项目或配送档，或勾选更多「清单包含」标签。"
        />
      ) : viewMode === 'production' && !deliverySlotKey ? (
        <EmptyStateCard
          title="请先选择配送档"
          hint="在上方选择配送档后，将显示本档出品汇总与普通商品、套餐拆解清单。"
        />
      ) : viewMode === 'production' &&
        productionTotals.normalItems.length === 0 &&
        productionTotals.bundleToolBreakdowns.length === 0 ? (
        <EmptyStateCard
          title="当前配送档暂无出品"
          hint="可切换项目或配送档，或勾选更多「清单包含」标签。"
        />
      ) : viewMode === 'profit' && profitTotals.rows.length === 0 ? (
        <EmptyStateCard
          title="当前筛选下无明细"
          hint="请勾选「清单包含」中的付款组，或放宽项目/时间筛选。"
        />
      ) : viewMode === 'delivery' ? (
        <>
          <section className="mb-6 rounded-xl border border-gray-100 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">配送清单</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {selectedSlotLabel} · {projectLabel} · 本店 · 按订单计数
              </p>
            </div>
            {deliveryManifest.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">当前筛选下无配送订单。</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {deliveryManifest.map((zone) => (
                  <li key={zone.zoneKey} className="px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {zone.zoneName}
                      <span className="ml-2 text-xs font-normal tabular-nums text-gray-500">
                        {zone.orderCount} 单
                      </span>
                    </p>
                    <ul className="mt-2 space-y-1.5 pl-1">
                      {zone.points.map((p) => (
                        <li
                          key={p.pointKey}
                          className="flex items-baseline justify-between gap-3 text-sm text-gray-700"
                        >
                          <span className="min-w-0">
                            {p.code ? (
                              <span className="font-mono text-xs font-semibold text-gray-900">
                                {p.code}
                              </span>
                            ) : null}
                            {p.code ? <span className="mx-1.5 text-gray-300">·</span> : null}
                            <span className="break-words">{p.name}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-gray-600">
                            {p.orderCount} 单
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <h3 className="mb-2 text-sm font-semibold text-gray-900">配送明细</h3>
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
              {sectionsByDp.map(([sectionKey, items]) => {
                const isManualSection =
                  items[0]?.dp.zoneKey === OTHER_DELIVERY_ZONE_KEY;
                return (
                <Fragment key={sectionKey}>
                  {isManualSection ? (
                    <tr className="bg-gray-50/90">
                      <td colSpan={8} className="px-2 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
                          <span className="text-xs font-semibold text-gray-800">
                            其他地址
                          </span>
                          <button
                            type="button"
                            className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-800 shadow-sm hover:bg-indigo-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              openManualMatchModal(items);
                            }}
                          >
                            手动匹配
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr aria-hidden className="bg-white">
                      <td colSpan={8} className="p-0">
                        <div className="h-px w-full bg-gray-200" />
                      </td>
                    </tr>
                  )}
                  {items.map(({ row, groups, scopedAmt, dp }) => {
                    const o = row.data;
                    const { dateStr, clockStr } = formatOrderTime(o);
                    const scopedLines = linesInSelectedBuckets(groups, bucketSelection);
                    const contentStr = formatLinesCell(scopedLines, lineMode);
                    const detailUrl = `${baseDash}/order/${encodeURIComponent(o.projectId)}/${encodeURIComponent(o.orderNumber)}`;
                    const missingProof = orderNeedsMissingProofLabel(o);
                    const flag = proofRiskDisplayTone(o);
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
                        <td className="w-[17%] align-top px-2 py-2 text-[11px] leading-tight text-gray-700" title={dp.line1}>
                          <span className="inline-flex flex-col">
                            <span className="font-extrabold text-gray-900">{dp.line1}</span>
                            <span className="line-clamp-1 break-words">{dp.line2}</span>
                          </span>
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
              );
              })}
            </tbody>
          </table>
        </div>
        </>
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
          <ProductionBundleBreakdownSection
            breakdowns={productionTotals.bundleToolBreakdowns}
            multiProjectScope={!projectFilter.trim()}
          />
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

      {manualModalOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-match-title"
          onClick={() => setManualModalOpen(false)}
        >
          <div
            className="max-h-[min(85vh,560px)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-2xl sm:pb-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
              <h3 id="manual-match-title" className="text-base font-semibold text-gray-900">
                手动匹配配送点
              </h3>
              <button
                type="button"
                className="inline-flex h-9 min-w-[2.25rem] shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="关闭"
                onClick={() => setManualModalOpen(false)}
              >
                <span className="text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              下列为「其他地址」订单。可选中配送点后关联；若无法归类到配送点，请选择「按地址配送」。
            </p>
            {manualModalErr ? (
              <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-sm text-red-700">
                {manualModalErr}
              </p>
            ) : null}
            <ul className="mt-4 space-y-3">
              {manualModalItems.map((item) => {
                const o = item.row.data;
                const busy = manualModalBusyId === item.row.id;
                return (
                  <li
                    key={item.row.id}
                    className="rounded-xl border border-gray-100 bg-gray-50/90 p-3"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      #{o.orderNumber} · {o.customerName?.trim() || '—'}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-700">
                      {manualOrderAddressDisplay(o)}
                    </p>
                    <label className="mt-2 block text-xs text-gray-600">
                      关联配送点
                      <select
                        className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900"
                        value={manualDpChoice[item.row.id] ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          setManualDpChoice((prev) => ({
                            ...prev,
                            [item.row.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">请选择配送点…</option>
                        {activeDeliveryPoints.map((p) => (
                          <option key={p.id} value={p.id}>
                            {(p.data.code ?? '').trim()
                              ? `[${(p.data.code ?? '').trim()}] `
                              : ''}
                            {(p.data.shortName ?? p.data.name ?? '').trim() || p.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300"
                        disabled={busy}
                        onClick={() => {
                          const v = manualDpChoice[item.row.id]?.trim();
                          if (!v) {
                            setManualModalErr('请先在下拉框中选择配送点');
                            return;
                          }
                          void runManualAssign(item, v);
                        }}
                      >
                        {busy ? '处理中…' : '关联所选配送点'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void runManualAssign(item, null)}
                      >
                        匹配不成功，按地址配送
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

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
