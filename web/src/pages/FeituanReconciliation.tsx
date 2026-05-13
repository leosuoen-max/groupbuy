import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { EmptyStateCard } from '../components/ui/EmptyStateCard';
import { useAuthUser } from '../hooks/useAuthUser';
import { DEFAULT_BUCKET_SELECTION } from '../lib/reconciliationGroups';
import { buildProfitCsv, buildProfitTotals } from '../lib/reconciliationProfit';
import { isFeituanAdmin } from '../lib/feituanService';
import { formatMYR } from '../lib/formatMYR';
import { listFeituanOrders, type OrderRow } from '../lib/orderService';
import { getProject } from '../lib/projectService';
import type { ProjectDoc } from '../types/firestore';

export default function FeituanReconciliation() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [projectsMap, setProjectsMap] = useState<Map<string, ProjectDoc>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) return;
      const orderRows = await listFeituanOrders();
      setOrders(orderRows);
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
    if (!user) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  const totals = useMemo(
    () => buildProfitTotals(orders, DEFAULT_BUCKET_SELECTION, projectsMap),
    [orders, projectsMap]
  );

  const exportCsv = () => {
    const csv = '\ufeff' + buildProfitCsv(totals);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '饭团成本对账.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

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
    <PageShell title="饭团对账" subtitle="按项目当前成本计算">
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/feituan"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          返回饭团管理
        </Link>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
        >
          刷新
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          导出 CSV
        </button>
      </div>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      <p className="mb-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-950">
        本页复用饭团订单的支付组口径，销售额按订单行实付 subtotal 汇总，成本按项目当前
        purchaseCost 汇总。管理员更新某个项目成本后，该项目所有订单会按新成本重算。
      </p>
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="text-xs font-medium text-emerald-800">销售额</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-950">
            {formatMYR(totals.totalSales)}
          </div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="text-xs font-medium text-amber-900">项目成本</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-amber-950">
            {formatMYR(totals.totalCost)}
          </div>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <div className="text-xs font-medium text-indigo-800">毛利</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-indigo-950">
            {formatMYR(totals.grossProfit)}
          </div>
        </div>
      </div>
      {totals.missingCostLineCount > 0 ? (
        <p className="mb-3 text-xs text-amber-800">
          有 {totals.missingCostLineCount} 条明细未配置项目成本，成本暂按 0。
        </p>
      ) : null}
      {totals.rows.length === 0 ? (
        <EmptyStateCard title="暂无饭团对账数据" hint="有饭团订单后会在这里显示销售、成本与毛利。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full min-w-[40rem] table-fixed border-collapse text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-700">
              <tr>
                <th className="w-[13%] px-2 py-2">类型</th>
                <th className="w-[27%] px-2 py-2">名称</th>
                <th className="w-[10%] px-2 py-2">数量</th>
                <th className="w-[16%] px-2 py-2">销售额</th>
                <th className="w-[16%] px-2 py-2">成本</th>
                <th className="w-[18%] px-2 py-2">毛利</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {totals.rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-2 py-2 text-xs text-gray-600">
                    {r.kind === 'scheme' ? '套餐方案' : '商品'}
                  </td>
                  <td className="px-2 py-2 text-gray-900">{r.name}</td>
                  <td className="px-2 py-2 tabular-nums">{r.quantity}</td>
                  <td className="px-2 py-2 tabular-nums">{formatMYR(r.sales)}</td>
                  <td className="px-2 py-2 tabular-nums">{formatMYR(r.cost)}</td>
                  <td className="px-2 py-2 font-medium tabular-nums text-emerald-900">
                    {formatMYR(r.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
