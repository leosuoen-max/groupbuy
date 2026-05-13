import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  listFeituanDeliverySets,
  updateProjectFeituanDeliveryZones,
  type FeituanDeliverySetRow,
} from '../lib/feituanDeliveryService';
import { isFeituanAdmin } from '../lib/feituanService';
import { getProject, type ProjectRow } from '../lib/projectService';

export default function FeituanProjectDelivery() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [zones, setZones] = useState<FeituanDeliverySetRow[]>([]);
  const [useDefaultAll, setUseDefaultAll] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const decodedProjectId = decodeURIComponent(projectId);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) return;
      const [projectRow, zoneRows] = await Promise.all([
        getProject(decodedProjectId),
        listFeituanDeliverySets({ includeInactive: true }),
      ]);
      if (!projectRow) {
        setProject(null);
        setErr('项目不存在');
        return;
      }
      const configured = projectRow.data.feituanDeliveryZoneIds ?? [];
      const activeZoneIds = zoneRows
        .filter((row) => row.data.isActive !== false)
        .map((row) => row.id);
      setProject(projectRow);
      setZones(zoneRows);
      setUseDefaultAll(configured.length === 0);
      setSelectedIds(configured.length > 0 ? configured : activeZoneIds);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [decodedProjectId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  const effectiveZoneIds = useMemo(
    () =>
      useDefaultAll
        ? zones.filter((row) => row.data.isActive !== false).map((row) => row.id)
        : selectedIds,
    [selectedIds, useDefaultAll, zones]
  );

  const activePointCount = useMemo(() => {
    const selected = new Set(effectiveZoneIds);
    return zones
      .filter((row) => selected.has(row.id) && row.data.isActive !== false)
      .flatMap((row) => row.data.points ?? [])
      .filter((point) => point.isActive !== false).length;
  }, [effectiveZoneIds, zones]);

  const toggle = (id: string) => {
    setUseDefaultAll(false);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const save = async () => {
    if (!user || !project) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await updateProjectFeituanDeliveryZones({
        actorUid: user.uid,
        projectId: project.id,
        zoneIds: useDefaultAll ? [] : selectedIds,
      });
      setMsg('项目配送区已保存');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading || allowed == null) {
    return (
      <PageShell title="项目配送" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="项目配送" subtitle="无权限">
        <p className="text-sm text-gray-700">当前账号无饭团管理员权限。</p>
      </PageShell>
    );
  }

  if (!project) {
    return (
      <PageShell title="项目配送" subtitle="未找到项目">
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <Link to="/admin/feituan" className="mt-3 inline-block text-sm text-indigo-600">
          返回饭团管理
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="项目配送" subtitle={project.data.title || '未命名项目'}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/feituan"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          返回饭团管理
        </Link>
        <Link
          to="/admin/feituan/delivery"
          className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-900"
        >
          管理配送区
        </Link>
      </div>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {msg ? <p className="mb-3 text-sm text-emerald-700">{msg}</p> : null}
      <p className="mb-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-950">
        未指定时默认开放全部启用配送区。指定后，顾客只能选择所选配送区内的启用配送点；地址自动推荐仍使用这些配送点。
      </p>
      <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm shadow-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={useDefaultAll}
          onChange={(e) => setUseDefaultAll(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-gray-900">
            默认全选所有启用配送区
          </span>
          <span className="mt-1 block text-xs text-gray-500">
            后续新增启用配送区也会自动开放给该项目。
          </span>
        </span>
      </label>
      <div className="mb-3 text-xs text-gray-600">
        当前开放配送区：{effectiveZoneIds.length} 个；可用配送点：{activePointCount} 个
      </div>
      <div className="space-y-2">
        {zones.length === 0 ? (
          <p className="text-sm text-gray-600">暂无配送区，请先新增。</p>
        ) : (
          zones.map((row) => (
            <label
              key={row.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm shadow-sm ${
                useDefaultAll
                  ? 'border-gray-100 bg-gray-50'
                  : 'border-gray-100 bg-white'
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                disabled={useDefaultAll}
                checked={effectiveZoneIds.includes(row.id)}
                onChange={() => toggle(row.id)}
              />
              <span className="min-w-0">
                <span className="font-semibold text-gray-900">{row.data.name}</span>
                {row.data.isActive === false ? (
                  <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700">
                    停用
                  </span>
                ) : null}
                <span className="ml-2 text-xs text-gray-500">
                  {row.data.points?.filter((p) => p.isActive !== false).length ?? 0}{' '}
                  个启用配送点
                </span>
                {row.data.description ? (
                  <span className="mt-1 block text-xs text-gray-500">
                    {row.data.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="sticky bottom-0 mt-4 border-t border-gray-100 bg-white/95 py-3 backdrop-blur">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="h-11 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:bg-gray-300"
        >
          {saving ? '保存中…' : '保存项目配送区'}
        </button>
      </div>
    </PageShell>
  );
}
