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
  deliveryPointLabel,
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
} from '../../lib/reconciliationSummary';
import { parseScreenshotEntries } from '../../lib/paymentScreenshotHelpers';
import { listOrdersByShopId, type OrderRow } from '../../lib/orderService';
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
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyOk, setCopyOk] = useState(false);
  const [bucketSelection, setBucketSelection] = useState<BucketSelection>(
    () => ({ ...DEFAULT_BUCKET_SELECTION })
  );
  const [lineMode, setLineMode] = useState<'all' | 'first'>('first');

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

  const totals = useMemo(
    () => buildReconciliationTotals(scopedOrders),
    [scopedOrders]
  );

  const fullCaliberAmount =
    totals.confirmedAmount + totals.pendingAmount + totals.unpaidAmount;
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
        dp: deliveryPointLabel(r.data),
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
  }, [scopedOrders, bucketSelection]);

  const sectionsByDp = useMemo(() => {
    const m = new Map<string, typeof tableRows>();
    for (const item of tableRows) {
      if (!m.has(item.dp)) m.set(item.dp, []);
      m.get(item.dp)!.push(item);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }, [tableRows]);

  const handleCopy = async () => {
    const text = buildReconciliationCopyText({
      shopName,
      projectLabel,
      rows: scopedOrders,
      totals,
      bucketSelection,
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
    const csv = '\ufeff' + buildReconciliationCsv(scopedOrders, bucketSelection);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `对账单-${slug}-${projectFilter || 'all'}-${bucketFileSuffix}.csv`;
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
        清单按「付款组」统计金额（首单 / 加购各一档）；汇总卡片为当前项目与时间筛选下的全量组口径，清单可通过下方标签筛选包含哪些组。
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
          <div className="text-xs font-medium text-emerald-800">已确认到账（组口径）</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
            {formatMYR(totals.confirmedAmount)}
          </div>
          <div className="text-xs text-emerald-800">{totals.confirmedCount} 单</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="text-xs font-medium text-amber-900">待确认金额（组口径）</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-amber-950">
            {formatMYR(totals.pendingAmount)}
          </div>
          <div className="text-xs text-amber-900">{totals.pendingCount} 单</div>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <div className="text-xs font-medium text-red-900">待付款（组口径）</div>
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

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm">
        <div className="font-medium">全口径核对（组金额之和）</div>
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
          有效订单率（订单状态已确认 / 未取消单数）：
          <strong>{totals.effectiveRatePercent}%</strong>
        </p>
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

      <div className="mb-4 flex flex-wrap gap-2">
        <ActionButton type="button" variant="primary" onClick={() => void handleCopy()}>
          {copyOk ? '已复制' : '复制对账清单'}
        </ActionButton>
        <ActionButton type="button" variant="secondary" onClick={handleExportCsv}>
          导出 CSV
        </ActionButton>
      </div>

      {tableRows.length === 0 ? (
        <EmptyStateCard
          title="当前筛选范围暂无订单"
          hint="可放宽时间窗口、切换项目，或勾选更多「清单包含」标签。"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-700">
              <tr>
                <th className="px-3 py-2">配送点</th>
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2">付款方</th>
                <th className="px-3 py-2">订单</th>
                <th className="px-3 py-2">内容</th>
                <th className="px-3 py-2">清单金额</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">凭证</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sectionsByDp.map(([dpLabel, items]) => (
                <Fragment key={dpLabel}>
                  <tr className="bg-gray-100/90">
                    <td
                      colSpan={8}
                      className="px-3 py-1.5 text-xs font-semibold text-gray-800"
                    >
                      配送点：{dpLabel}
                    </td>
                  </tr>
                  {items.map(({ row, groups, scopedAmt }) => {
                    const o = row.data;
                    const d = o.createdAt?.toDate?.();
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const timeStr = d
                      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
                      : '—';
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
                        <td className="whitespace-nowrap px-3 py-2 text-gray-800">{dpLabel}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-700">{timeStr}</td>
                        <td className="px-3 py-2 text-gray-900">{o.customerName}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-indigo-700 underline-offset-2">
                          #{o.orderNumber}
                        </td>
                        <td
                          className={`max-w-[14rem] px-3 py-2 text-gray-700 ${lineMode === 'all' ? 'whitespace-normal' : 'truncate'}`}
                          title={contentStr}
                        >
                          {contentStr}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums font-medium">
                          {formatMYR(scopedAmt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <StatusChip
                            tone={toChipTone(o.status)}
                            label={statusLabel(o.status)}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {missingProof ? (
                            <span className="font-medium text-amber-900">缺少凭证</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
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
