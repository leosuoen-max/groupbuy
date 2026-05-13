import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  approveFeituanProject,
  delistFeituanProject,
  isFeituanAdmin,
  listFeituanProjects,
  rejectFeituanProject,
} from '../lib/feituanService';
import type { ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';

function fmtTs(t: { toDate?: () => Date } | null | undefined): string {
  if (!t?.toDate) return '—';
  try {
    return t.toDate().toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function statusLabel(s: ProjectRow['data']['feituanStatus']): string {
  if (s === 'pending') return '待审';
  if (s === 'listed') return '已上架';
  if (s === 'rejected') return '已驳回';
  if (s === 'delisted') return '已下架';
  return '未提交';
}

export default function FeituanAdmin() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Array<{ project: ProjectRow; shop: ShopRow | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) {
        setRows([]);
        return;
      }
      const projects = await listFeituanProjects(['pending', 'listed', 'rejected', 'delisted']);
      const items = await Promise.all(
        projects.map(async (project) => ({
          project,
          shop: await getShopById(project.data.shopId),
        }))
      );
      setRows(items);
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
      setRows([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  const pendingCount = useMemo(
    () => rows.filter((x) => x.project.data.feituanStatus === 'pending').length,
    [rows]
  );

  const approve = async (projectId: string) => {
    if (!user) return;
    setBusyId(projectId);
    setErr(null);
    try {
      await approveFeituanProject(projectId, user.uid);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (projectId: string) => {
    if (!user) return;
    const reason = window.prompt('驳回原因（可留空）：', '') ?? '';
    setBusyId(projectId);
    setErr(null);
    try {
      await rejectFeituanProject(projectId, user.uid, reason);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const delist = async (projectId: string) => {
    if (!user) return;
    const ok = window.confirm('确定下架该饭团项目吗？下架后不再显示在饭团主页。');
    if (!ok) return;
    setBusyId(projectId);
    setErr(null);
    try {
      await delistFeituanProject(projectId, user.uid);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading || allowed === null) {
    return (
      <PageShell title="饭团管理" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="饭团管理" subtitle="未登录">
        <Link to="/login?returnTo=/admin/feituan" className="text-indigo-600">
          去登录
        </Link>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="饭团管理" subtitle="无权限">
        <p className="text-sm text-gray-700">
          当前账号无饭团管理员权限。可在 Firestore 创建{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">feituan_admins</code>
          文档，或使用平台管理员账号访问。
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell title="饭团管理" subtitle={`待审 ${pendingCount} 个`}>
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
          to="/feituan"
          className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-900"
        >
          打开饭团主页
        </Link>
      </div>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">暂无饭团项目。</p>
      ) : (
        <div className="space-y-3">
          {rows.map(({ project, shop }) => {
            const p = project.data;
            return (
              <article key={project.id} className="rounded-xl border border-gray-100 bg-white p-4 text-sm shadow-sm">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-500">{shop?.data.name ?? '未知店铺'}</p>
                    <h2 className="font-semibold text-gray-900">{p.title || '未命名项目'}</h2>
                    <p className="mt-1 text-xs text-gray-500">提交：{fmtTs(p.feituanSubmittedAt)}</p>
                  </div>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900">
                    {statusLabel(p.feituanStatus)}
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">
                  <div>商品：{p.products?.length ?? 0}</div>
                  <div>套餐：{p.bundleTools?.length ?? 0}</div>
                  <div>状态：{p.status}</div>
                  <div>饭团审核：{fmtTs(p.feituanReviewedAt)}</div>
                </div>
                {p.feituanRejectReason ? (
                  <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                    驳回原因：{p.feituanRejectReason}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {p.feituanStatus === 'pending' || p.feituanStatus === 'rejected' || p.feituanStatus === 'delisted' ? (
                    <button
                      type="button"
                      disabled={busyId === project.id}
                      onClick={() => void approve(project.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300"
                    >
                      批准上架
                    </button>
                  ) : null}
                  {p.feituanStatus === 'pending' ? (
                    <button
                      type="button"
                      disabled={busyId === project.id}
                      onClick={() => void reject(project.id)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      驳回
                    </button>
                  ) : null}
                  {p.feituanStatus === 'listed' ? (
                    <button
                      type="button"
                      disabled={busyId === project.id}
                      onClick={() => void delist(project.id)}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50"
                    >
                      下架
                    </button>
                  ) : null}
                  {p.feituanStatus === 'listed' ? (
                    <Link
                      to={`/feituan/projects/${encodeURIComponent(project.id)}`}
                      className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900"
                    >
                      查看饭团页
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
