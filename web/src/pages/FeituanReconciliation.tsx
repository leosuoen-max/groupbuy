import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ProofDatetimeFilterFields } from '../components/reconciliation/ProofDatetimeFilterFields';
import { ProductionBundleBreakdownSection } from '../components/reconciliation/ProductionBundleBreakdownSection';
import { DeliverySummaryStatsBar } from '../components/reconciliation/DeliverySummaryStatsBar';
import { ProfitSummaryStatsBar } from '../components/reconciliation/ProfitSummaryStatsBar';
import { ProductionSummaryStatsBar } from '../components/reconciliation/ProductionSummaryStatsBar';
import { PageShell } from '../components/PageShell';
import { ActionButton } from '../components/ui/ActionButton';
import { EmptyStateCard } from '../components/ui/EmptyStateCard';
import { StatusChip } from '../components/ui/StatusChip';
import { useAuthUser } from '../hooks/useAuthUser';
import { isFeituanAdmin } from '../lib/feituanService';
import { listActiveFeituanDeliveryPoints } from '../lib/feituanDeliveryService';
import { formatMYR } from '../lib/formatMYR';
import {
  DEFAULT_BUCKET_SELECTION,
  PRODUCTION_DEFAULT_BUCKET_SELECTION,
  linesInSelectedBuckets,
  listOrderPaymentGroups,
  orderMatchesBucketSelection,
  orderNeedsMissingProofLabel,
  proofRiskDisplayTone,
  scopedGroupAmount,
  type BucketSelection,
  type GroupBucket,
} from '../lib/reconciliationGroups';
import {
  buildDeliveryDetailCsv,
  buildDeliveryManifest,
  buildDeliveryManifestCopyText,
  buildDeliveryManifestCsv,
  summarizeDeliveryManifest,
  buildFeituanDeliveryPointMap,
  listDeliverySlotOptionsFromOrders,
  orderMatchesDeliverySlotKey,
  resolveDeliveryPointGroup,
  type DeliveryPointGroup,
} from '../lib/feituanDeliveryReconciliation';
import {
  buildProductionCopyText,
  buildProductionCsv,
  buildProductionTotals,
} from '../lib/reconciliationSummary';
import {
  buildProfitCopyText,
  buildProfitCsv,
  buildProfitTotals,
  formatProfitReconciliationScopeCaption,
} from '../lib/reconciliationProfit';
import { listOrderCardPaymentApplications } from '../lib/orderCardPaymentApplications';
import { listOrderFeituanWalletPaymentApplications } from '../lib/orderFeituanWalletApplications';
import { listFeituanOrders, type OrderRow } from '../lib/orderService';
import { parseScreenshotEntries } from '../lib/paymentScreenshotHelpers';
import { getProject } from '../lib/projectService';
import type {
  OrderDoc,
  OrderLineDoc,
  OrderStatus,
  ProjectDoc,
} from '../types/firestore';
import type { MockDeliveryPoint } from '../types/orderDraft';

type ViewMode = 'delivery' | 'production' | 'profit';

type DeliveryTableItem = {
  row: OrderRow;
  groups: ReturnType<typeof listOrderPaymentGroups>;
  dp: DeliveryPointGroup;
  scopedAmt: number;
};

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

function parseDateTimeMs(yyyyMmDdHhMm: string): number | null {
  if (!yyyyMmDdHhMm.trim()) return null;
  const ms = new Date(yyyyMmDdHhMm).getTime();
  return Number.isNaN(ms) ? null : ms;
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
  if (
    listOrderFeituanWalletPaymentApplications(order).some((x) =>
      inRange(x.appliedAt?.toMillis?.(), startMs, endMs)
    )
  ) {
    return true;
  }
  return listOrderCardPaymentApplications(order).some((x) =>
    inRange(x.appliedAt?.toMillis?.(), startMs, endMs)
  );
}

function formatOrderTime(o: OrderDoc): { dateStr: string; clockStr: string } {
  const d = o.createdAt?.toDate?.();
  if (!d) return { dateStr: '—', clockStr: '—' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateStr: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    clockStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function viewButtonClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium ${
    active ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-600'
  }`;
}

export default function FeituanReconciliation() {
  const { user, loading: authLoading } = useAuthUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') ?? '';
  const proofStart = searchParams.get('proofStart') ?? '';
  const proofEnd = searchParams.get('proofEnd') ?? '';
  const deliverySlotKey = searchParams.get('deliverySlot') ?? '';

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [deliveryPoints, setDeliveryPoints] = useState<MockDeliveryPoint[]>([]);
  const [projectsMap, setProjectsMap] = useState<Map<string, ProjectDoc>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [bucketSelection, setBucketSelection] = useState<BucketSelection>(
    () => ({ ...DEFAULT_BUCKET_SELECTION })
  );
  const [productionBucketSelection, setProductionBucketSelection] =
    useState<BucketSelection>(() => ({ ...PRODUCTION_DEFAULT_BUCKET_SELECTION }));
  const [lineMode, setLineMode] = useState<'all' | 'first'>('first');
  const [viewMode, setViewMode] = useState<ViewMode>('delivery');

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) {
        setOrders([]);
        setDeliveryPoints([]);
        setProjectsMap(new Map());
        return;
      }
      const [orderRows, pointRows] = await Promise.all([
        listFeituanOrders(),
        listActiveFeituanDeliveryPoints().catch(() => [] as MockDeliveryPoint[]),
      ]);
      setOrders(orderRows);
      setDeliveryPoints(pointRows);

      const projectIds = [...new Set(orderRows.map((row) => row.data.projectId))];
      const entries = await Promise.all(
        projectIds.map(async (id) => {
          const row = await getProject(id);
          return [id, row?.data ?? null] as const;
        })
      );
      const next = new Map<string, ProjectDoc>();
      for (const [id, data] of entries) {
        if (data) next.set(id, data);
      }
      setProjectsMap(next);
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
        setLoading(false);
        return;
      }
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, refresh, user]);

  const feituanPointById = useMemo(
    () => buildFeituanDeliveryPointMap(deliveryPoints),
    [deliveryPoints]
  );

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
    deliverySlotOptions.find((x) => x.key === deliverySlotKey)?.label ?? deliverySlotKey;

  const deliveryScopedOrders = useMemo(() => {
    if (!deliverySlotKey.trim()) return [];
    return projectScopedOrders.filter(
      (r) =>
        r.data.status !== 'cancelled' &&
        orderMatchesDeliverySlotKey(r.data, deliverySlotKey)
    );
  }, [deliverySlotKey, projectScopedOrders]);

  const deliveryManifest = useMemo(
    () => buildDeliveryManifest(deliveryScopedOrders, bucketSelection, feituanPointById),
    [bucketSelection, deliveryScopedOrders, feituanPointById]
  );

  const deliveryManifestSummary = useMemo(
    () => summarizeDeliveryManifest(deliveryManifest),
    [deliveryManifest]
  );

  const productionTotals = useMemo(
    () =>
      buildProductionTotals(
        deliveryScopedOrders,
        productionBucketSelection,
        projectsMap
      ),
    [deliveryScopedOrders, productionBucketSelection, projectsMap]
  );

  const profitTotals = useMemo(
    () => buildProfitTotals(scopedOrders, bucketSelection, projectsMap),
    [bucketSelection, projectsMap, scopedOrders]
  );

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of orders) {
      const id = r.data.projectId;
      const title = r.data.projectTitle?.trim() || id;
      m.set(id, title);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
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
        dp: resolveDeliveryPointGroup(r.data, feituanPointById),
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
  }, [bucketSelection, deliveryScopedOrders, deliverySlotKey, feituanPointById]);

  const sectionsByDp = useMemo(() => {
    const m = new Map<string, DeliveryTableItem[]>();
    for (const item of deliveryTableRows) {
      const key = item.dp.sortKey;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(item);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }, [deliveryTableRows]);

  useEffect(() => {
    if (!deliverySlotKey.trim()) return;
    if (deliverySlotOptions.some((x) => x.key === deliverySlotKey)) return;
    const next = new URLSearchParams(searchParams);
    next.delete('deliverySlot');
    setSearchParams(next, { replace: true });
  }, [deliverySlotKey, deliverySlotOptions, searchParams, setSearchParams]);

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
              shopName: '大马饭团',
              projectLabel,
              totals: productionTotals,
            })
          : buildProfitCopyText({
              shopName: '大马饭团',
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

  const handleExportCsv = () => {
    const csv = '\ufeff' + (
      viewMode === 'delivery'
        ? [
            buildDeliveryManifestCsv(deliveryManifest),
            '',
            buildDeliveryDetailCsv(
              deliveryScopedOrders,
              bucketSelection,
              feituanPointById
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
        ? `饭团配送统计-${projectFilter || 'all'}-${slotSuffix}-${bucketFileSuffix}.csv`
        : viewMode === 'production'
          ? `饭团生产统计-${projectFilter || 'all'}-${slotSuffix}-${bucketFileSuffix}.csv`
          : `饭团财务统计-${projectFilter || 'all'}-${bucketFileSuffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function toggleBucket(k: GroupBucket) {
    const setter =
      viewMode === 'production' ? setProductionBucketSelection : setBucketSelection;
    setter((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      if (!next.confirmed && !next.pending && !next.unpaid) return prev;
      return next;
    });
  }

  if (authLoading || loading || allowed == null) {
    return (
      <PageShell title="饭团对账" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="饭团对账" subtitle="无权限">
        <p className="text-sm text-gray-700">当前账号无饭团管理员权限。</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="饭团对账" subtitle="配送统计、生产统计与财务统计">
      {err ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {err}
        </p>
      ) : null}

      <p className="mb-4 text-xs text-gray-600">
        {viewMode === 'delivery'
          ? '配送统计按配送档汇总清单与明细；须先选择配送档。明细金额仍按支付组（首单 / 加购）统计，可通过「清单包含」筛选。'
          : viewMode === 'production'
            ? '生产统计按项目与配送档筛选；须先选择配送档。清单包含默认仅「已确认组」，可手动勾选其他支付组。'
            : '财务统计按凭证/自动确认时间与项目筛选，成本按饭团管理员录入的采购成本计算。'}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-700">视图：</span>
        <button
          type="button"
          className={viewButtonClass(viewMode === 'delivery')}
          onClick={() => setViewMode('delivery')}
        >
          配送统计
        </button>
        <button
          type="button"
          className={viewButtonClass(viewMode === 'production')}
          onClick={() => setViewMode('production')}
        >
          项目生产统计
        </button>
        <button
          type="button"
          className={viewButtonClass(viewMode === 'profit')}
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
              选项来自当前项目筛选下已有订单的配送档；无档订单（如长期项目未付款）不会出现在列表中。
            </span>
          </label>
        ) : (
          <ProofDatetimeFilterFields
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            proofStart={proofStart}
            proofEnd={proofEnd}
            startLabel="凭证/自动确认时间起"
            endLabel="凭证/自动确认时间止"
            hint="时间筛选按顾客上传截图、免凭证确认、饭团钱包/次卡自动确认时间统计。若要表示「5月4日24:00」，请填写次日 00:00。"
          />
        )}
      </div>

      {viewMode === 'delivery' && deliverySlotKey ? (
        <DeliverySummaryStatsBar
          summary={deliveryManifestSummary}
          scopeCaption={`${selectedSlotLabel} · ${projectLabel} · 全平台订单`}
        />
      ) : null}

      {viewMode === 'production' ? (
        <ProductionSummaryStatsBar
          totals={productionTotals}
          scopeCaption={`${selectedSlotLabel || '未选配送档'} · ${projectLabel} · 全平台订单`}
        />
      ) : viewMode === 'profit' ? (
        <>
          <ProfitSummaryStatsBar
            totals={profitTotals}
            scopeCaption={formatProfitReconciliationScopeCaption({
              projectLabel,
              proofStart,
              proofEnd,
              orderScopeLabel: '全平台订单',
            })}
          />
          {profitTotals.missingProjectCount > 0 ? (
            <p className="mb-2 text-xs text-amber-800">
              有 {profitTotals.missingProjectCount} 笔订单未能加载项目菜单（无法拆分成本/让价）。
            </p>
          ) : null}
          {profitTotals.missingCostLineCount > 0 ? (
            <p className="mb-4 text-xs text-amber-800">
              有 {profitTotals.missingCostLineCount}{' '}
              条明细未配置采购成本（已计入销售额，成本按 0）。
            </p>
          ) : null}
        </>
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
            className={viewButtonClass(activeBucketSelection[k])}
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
            className={viewButtonClass(lineMode === 'first')}
            onClick={() => setLineMode('first')}
          >
            仅首行
          </button>
          <button
            type="button"
            className={viewButtonClass(lineMode === 'all')}
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
          配送点列上行：<strong className="font-medium text-gray-700">配送区名 + 编号</strong>
          ，下行为配送点名称。无法在库中匹配的配送点 ID 归入「未知配送点」。明细表可左右滑动查看。
        </p>
      ) : viewMode === 'production' ? (
        <p className="mb-4 text-xs text-gray-500">
          生产统计按当前项目、配送档与「清单包含」筛选。普通商品按下单份数累计；套餐按系列中具体单项拆解累计，供厨房备料与出品参考。
        </p>
      ) : (
        <p className="mb-4 text-xs text-gray-500">
          按商品/套餐方案汇总销售额、采购成本与毛利；筛选范围与「清单包含」一致，可包含待付款、待确认组。
        </p>
      )}

      {viewMode === 'delivery' && !deliverySlotKey ? (
        <EmptyStateCard
          title="请先选择配送档"
          hint="在上方选择配送档后，将显示配送清单与配送明细。选项来自当前项目下已有订单。"
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
          hint="请勾选「清单包含」中的支付组，或放宽项目/时间筛选。"
        />
      ) : viewMode === 'delivery' ? (
        <>
          <section className="mb-6 rounded-xl border border-gray-100 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">配送清单</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {selectedSlotLabel} · {projectLabel} · 按订单计数
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
              {sectionsByDp.map(([sectionKey, items]) => (
                <Fragment key={sectionKey}>
                  <tr aria-hidden className="bg-white">
                    <td colSpan={8} className="p-0">
                      <div className="h-px w-full bg-gray-200" />
                    </td>
                  </tr>
                  {items.map(({ row, groups, scopedAmt, dp }) => {
                    const o = row.data;
                    const { dateStr, clockStr } = formatOrderTime(o);
                    const scopedLines = linesInSelectedBuckets(groups, bucketSelection);
                    const contentStr = formatLinesCell(scopedLines, lineMode);
                    const detailUrl = `/admin/feituan/order/${encodeURIComponent(o.projectId)}/${encodeURIComponent(o.orderNumber)}`;
                    const missingProof = orderNeedsMissingProofLabel(o);
                    const flag = proofRiskDisplayTone(o);
                    return (
                      <tr
                        key={row.id}
                        role="link"
                        tabIndex={0}
                        className="cursor-pointer bg-white hover:bg-orange-50/50"
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
                        <td className="whitespace-nowrap px-2 py-2 align-top font-mono text-[11px] text-orange-700 underline-offset-2">
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
                        <td className="whitespace-nowrap px-2 py-2 align-top text-center text-xs">
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
                  <td className="min-w-0 break-words px-2 py-2 text-gray-900">{r.name}</td>
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
          to="/admin/feituan/orders"
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          ← 订单管理
        </Link>
        <Link
          to="/admin/feituan"
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          返回饭团管理
        </Link>
      </div>
    </PageShell>
  );
}
