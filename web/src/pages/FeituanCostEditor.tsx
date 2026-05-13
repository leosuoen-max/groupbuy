import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  confirmFeituanProjectCosts,
  isFeituanAdmin,
  updateFeituanProjectCosts,
} from '../lib/feituanService';
import { formatMYR } from '../lib/formatMYR';
import { getProject, type ProjectRow } from '../lib/projectService';

function toInputValue(v: number | undefined): string {
  return v == null || Number.isNaN(Number(v)) ? '' : String(v);
}

function parseCost(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function collectZeroCostLabels(
  row: ProjectRow,
  productCosts: Record<string, string>,
  schemeCosts: Record<string, string>
): string[] {
  const labels: string[] = [];
  for (const product of row.data.products ?? []) {
    if (parseCost(productCosts[product.id] ?? '') === 0) {
      labels.push(product.name || '未命名商品');
    }
  }
  for (const tool of row.data.bundleTools ?? []) {
    for (const scheme of tool.schemes) {
      const key = `${tool.id}:${scheme.id}`;
      if (parseCost(schemeCosts[key] ?? '') === 0) {
        labels.push(`${tool.name || '未命名套餐'} / ${scheme.name || '未命名方案'}`);
      }
    }
  }
  return labels;
}

export default function FeituanCostEditor() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [row, setRow] = useState<ProjectRow | null>(null);
  const [productCosts, setProductCosts] = useState<Record<string, string>>({});
  const [schemeCosts, setSchemeCosts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) return;
      const next = await getProject(decodeURIComponent(projectId));
      if (!next) {
        setErr('项目不存在');
        setRow(null);
        return;
      }
      setRow(next);
      setProductCosts(
        Object.fromEntries(
          (next.data.products ?? []).map((p) => [p.id, toInputValue(p.purchaseCost)])
        )
      );
      const schemeEntries: Array<[string, string]> = [];
      for (const tool of next.data.bundleTools ?? []) {
        for (const scheme of tool.schemes) {
          schemeEntries.push([
            `${tool.id}:${scheme.id}`,
            toInputValue(scheme.purchaseCost),
          ]);
        }
      }
      setSchemeCosts(Object.fromEntries(schemeEntries));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  const save = async () => {
    if (!user || !row) return;
    const zeroCostLabels = collectZeroCostLabels(row, productCosts, schemeCosts);
    if (zeroCostLabels.length > 0) {
      const preview = zeroCostLabels.slice(0, 8).join('\n');
      const more =
        zeroCostLabels.length > 8 ? `\n等 ${zeroCostLabels.length} 项` : '';
      const ok = window.confirm(
        `检测到以下项目成本为 0：\n${preview}${more}\n\n保存后饭团对账会按 0 成本计算，确定继续保存吗？`
      );
      if (!ok) {
        setMsg('已取消保存，请检查成本为 0 的项目。');
        return;
      }
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await updateFeituanProjectCosts({
        projectId: row.id,
        actorUid: user.uid,
        productCosts: Object.fromEntries(
          Object.entries(productCosts).map(([id, v]) => [id, parseCost(v)])
        ),
        schemeCosts: Object.fromEntries(
          Object.entries(schemeCosts).map(([id, v]) => [id, parseCost(v)])
        ),
      });
      setMsg('成本已保存并确认');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmOnly = async () => {
    if (!user || !row) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await confirmFeituanProjectCosts(row.id, user.uid);
      setMsg('已确认当前项目成本');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '确认失败');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading || allowed == null) {
    return (
      <PageShell title="饭团成本" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="饭团成本" subtitle="无权限">
        <p className="text-sm text-gray-700">当前账号无饭团管理员权限。</p>
      </PageShell>
    );
  }

  if (!row) {
    return (
      <PageShell title="饭团成本" subtitle="未找到项目">
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <Link to="/admin/feituan" className="mt-3 inline-block text-sm text-indigo-600">
          返回饭团管理
        </Link>
      </PageShell>
    );
  }

  const p = row.data;
  const zeroCostLabels = collectZeroCostLabels(row, productCosts, schemeCosts);

  return (
    <PageShell title="饭团成本" subtitle={p.title || '未命名项目'}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/feituan"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          返回饭团管理
        </Link>
        <button
          type="button"
          disabled={saving}
          onClick={() => void confirmOnly()}
          className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900 disabled:opacity-50"
        >
          只确认当前成本
        </button>
      </div>
      <p className="mb-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-950">
        成本按项目当前商品/套餐方案计算。管理员更新某项成本后，该项目历史与未来订单的对账都会按新成本重算；其他项目不受影响。
      </p>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {msg ? <p className="mb-3 text-sm text-emerald-700">{msg}</p> : null}
      {zeroCostLabels.length > 0 ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          检测到 {zeroCostLabels.length}{' '}
          项成本为 0。保存前会再次确认；确认后这些项目在饭团对账中按 0 成本计算。
        </p>
      ) : null}
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">普通商品成本</h2>
          <div className="space-y-2">
            {(p.products ?? []).map((product) => (
              <label
                key={product.id}
                className="grid grid-cols-[1fr_8rem] items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium text-gray-900">{product.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    售价 {formatMYR(product.price)}
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="成本"
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                  value={productCosts[product.id] ?? ''}
                  onChange={(e) =>
                    setProductCosts((prev) => ({
                      ...prev,
                      [product.id]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">套餐方案成本</h2>
          <div className="space-y-3">
            {(p.bundleTools ?? []).map((tool) => (
              <div key={tool.id} className="rounded-lg border border-gray-100 p-3">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">{tool.name}</h3>
                <div className="space-y-2">
                  {tool.schemes.map((scheme) => {
                    const key = `${tool.id}:${scheme.id}`;
                    return (
                      <label
                        key={key}
                        className="grid grid-cols-[1fr_8rem] items-center gap-3 text-sm"
                      >
                        <span>
                          {scheme.name}
                          <span className="ml-2 text-xs text-gray-500">
                            售价 {formatMYR(scheme.price)}
                          </span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="成本"
                          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                          value={schemeCosts[key] ?? ''}
                          onChange={(e) =>
                            setSchemeCosts((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="sticky bottom-0 mt-4 border-t border-gray-100 bg-white/95 py-3 backdrop-blur">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="h-11 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:bg-gray-300"
        >
          {saving ? '保存中…' : '保存并确认成本'}
        </button>
      </div>
    </PageShell>
  );
}
