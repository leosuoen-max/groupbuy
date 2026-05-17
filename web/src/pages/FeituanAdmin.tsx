import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  approveFeituanProject,
  delistFeituanProject,
  delistExpiredFeituanProjects,
  getFeituanProjectPublishBlocker,
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

function statusChipClass(s: ProjectRow['data']['feituanStatus']): string {
  if (s === 'pending') return 'bg-amber-100 text-amber-800';
  if (s === 'listed') return 'bg-emerald-100 text-emerald-800';
  if (s === 'rejected') return 'bg-red-100 text-red-700';
  if (s === 'delisted') return 'bg-gray-100 text-gray-600';
  return 'bg-gray-100 text-gray-600';
}

const quickLinkClass =
  'rounded-2xl border border-orange-100 bg-white px-3 py-3 text-center text-xs font-bold text-gray-900 shadow-sm active:bg-orange-50';

const actionButtonBase =
  'rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50';

type AdminProjectRow = { project: ProjectRow; shop: ShopRow | null };
type ProjectListTab = 'pending' | 'listed' | 'delisted' | 'rejected';

async function loadShopsById(projects: ProjectRow[]): Promise<Map<string, ShopRow | null>> {
  const shopIds = [...new Set(projects.map((project) => project.data.shopId))];
  const entries = await Promise.all(
    shopIds.map(async (shopId) => [shopId, await getShopById(shopId)] as const)
  );
  return new Map(entries);
}

export default function FeituanAdmin() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<AdminProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectListTab>('pending');

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
      await delistExpiredFeituanProjects(user.uid);
      const projects = await listFeituanProjects(['pending', 'listed', 'rejected', 'delisted']);
      const shopsById = await loadShopsById(projects);
      const items = projects.map((project) => ({
        project,
        shop: shopsById.get(project.data.shopId) ?? null,
      }));
      setRows(items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, refresh, user]);

  const pendingCount = useMemo(
    () => rows.filter((x) => x.project.data.feituanStatus === 'pending').length,
    [rows]
  );
  const listedCount = useMemo(
    () => rows.filter((x) => x.project.data.feituanStatus === 'listed').length,
    [rows]
  );
  const delistedCount = useMemo(
    () => rows.filter((x) => x.project.data.feituanStatus === 'delisted').length,
    [rows]
  );
  const rejectedCount = useMemo(
    () => rows.filter((x) => x.project.data.feituanStatus === 'rejected').length,
    [rows]
  );
  const sections = useMemo(
    () => [
      {
        key: 'pending' as const,
        title: '待审核',
        hint: '商户已提交，等待饭团确认上架。',
        rows: rows.filter((x) => x.project.data.feituanStatus === 'pending'),
      },
      {
        key: 'listed' as const,
        title: '已上架',
        hint: '当前正在饭团主页展示。',
        rows: rows.filter((x) => x.project.data.feituanStatus === 'listed'),
      },
      {
        key: 'delisted' as const,
        title: '已下架',
        hint: '包括手动下架和过截单时间自动下架。',
        rows: rows.filter((x) => x.project.data.feituanStatus === 'delisted'),
      },
      {
        key: 'rejected' as const,
        title: '已驳回',
        hint: '商户修改后可再次发布到饭团审核队列。',
        rows: rows.filter((x) => x.project.data.feituanStatus === 'rejected'),
      },
    ],
    [rows]
  );
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];

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

  const renderProjectCard = ({ project, shop }: AdminProjectRow) => {
    const p = project.data;
    const approveBlocker =
      p.feituanStatus === 'pending' ? getFeituanProjectPublishBlocker(p) : null;
    return (
      <article
        key={project.id}
        className="overflow-hidden rounded-3xl border border-orange-100 bg-white text-sm shadow-sm"
      >
        <div className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-orange-800">
                {shop?.data.name ?? '未知店铺'}
              </p>
              <h3 className="mt-0.5 line-clamp-2 text-[17px] font-black leading-tight text-gray-950">
                {p.title || '未命名项目'}
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                提交 {fmtTs(p.feituanSubmittedAt)} · 审核 {fmtTs(p.feituanReviewedAt)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusChipClass(p.feituanStatus)}`}
              >
                {statusLabel(p.feituanStatus)}
              </span>
              <Link
                to={`/admin/feituan/project/${encodeURIComponent(project.id)}`}
                className="text-xs font-semibold text-orange-700 underline-offset-2 hover:underline"
              >
                查看项目
              </Link>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl bg-orange-50/50 p-2 text-center text-xs text-gray-700">
            <div>
              <p className="font-black text-gray-950">{p.products?.length ?? 0}</p>
              <p>商品</p>
            </div>
            <div>
              <p className="font-black text-gray-950">{p.bundleTools?.length ?? 0}</p>
              <p>套餐</p>
            </div>
            <div>
              <p className="font-black text-gray-950">{p.status}</p>
              <p>状态</p>
            </div>
          </div>
          <p className="mb-2 rounded-2xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
            项目成本：
            {p.feituanCostConfirmedAt
              ? `已确认 ${fmtTs(p.feituanCostConfirmedAt)}`
              : '未确认'}
          </p>
          {p.feituanRejectReason ? (
            <p className="mb-2 rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-700">
              驳回原因：{p.feituanRejectReason}
            </p>
          ) : null}
          {approveBlocker ? (
            <p className="mb-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              暂不能批准：{approveBlocker}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-orange-50 pt-3">
            {p.feituanStatus === 'pending' ? (
              <button
                type="button"
                disabled={busyId === project.id || Boolean(approveBlocker)}
                onClick={() => void approve(project.id)}
                className={`${actionButtonBase} bg-emerald-600 text-white disabled:bg-gray-300`}
              >
                批准上架
              </button>
            ) : null}
            {p.feituanStatus === 'pending' ? (
              <button
                type="button"
                disabled={busyId === project.id}
                onClick={() => void reject(project.id)}
                className={`${actionButtonBase} border border-red-200 bg-red-50 text-red-700`}
              >
                驳回
              </button>
            ) : null}
            {p.feituanStatus === 'listed' ? (
              <button
                type="button"
                disabled={busyId === project.id}
                onClick={() => void delist(project.id)}
                className={`${actionButtonBase} border border-amber-200 bg-amber-50 text-amber-900`}
              >
                下架
              </button>
            ) : null}
            {p.feituanStatus === 'listed' ? (
              <Link
                to={`/feituan/projects/${encodeURIComponent(project.id)}`}
                className={`${actionButtonBase} border border-orange-200 bg-orange-50 text-orange-900`}
              >
                查看饭团页
              </Link>
            ) : null}
            <Link
              to={`/admin/feituan/costs/${encodeURIComponent(project.id)}`}
              className={`${actionButtonBase} border border-indigo-200 bg-indigo-50 text-indigo-900`}
            >
              成本确认/更新
            </Link>
            <Link
              to={`/admin/feituan/project-delivery/${encodeURIComponent(project.id)}`}
              className={`${actionButtonBase} border border-orange-200 bg-orange-50 text-orange-900`}
            >
              配送
            </Link>
          </div>
        </div>
      </article>
    );
  };

  if (authLoading) {
    return (
      <main className="min-h-svh bg-[#fffaf4] px-4 py-5">
        <h1 className="text-xl font-black text-gray-950">饭团管理</h1>
        <p className="text-sm text-gray-600">请稍候…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-svh bg-[#fffaf4] px-4 py-5">
        <h1 className="text-xl font-black text-gray-950">饭团管理</h1>
        <Link to="/login?returnTo=/admin/feituan" className="text-indigo-600">
          去登录
        </Link>
      </main>
    );
  }

  if (allowed === null) {
    return (
      <main className="min-h-svh bg-[#fffaf4] px-4 py-5">
        <h1 className="text-xl font-black text-gray-950">饭团管理</h1>
        <p className="text-sm text-gray-600">请稍候…</p>
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="min-h-svh bg-[#fffaf4] px-4 py-5">
        <h1 className="mb-3 text-xl font-black text-gray-950">饭团管理</h1>
        <p className="text-sm text-gray-700">
          当前账号无饭团管理员权限。可在 Firestore 创建{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">feituan_admins</code>
          文档，或使用平台管理员账号访问。
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-svh bg-[#fffaf4] px-4 pb-8 pt-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-black tracking-tight text-gray-950">饭团管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            待审 <span className="font-semibold text-orange-700">{pendingCount}</span> 个
            · 上架 {listedCount} 个 · 下架 {delistedCount} 个 · 驳回 {rejectedCount} 个
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="shrink-0 rounded-xl border border-orange-100 bg-white px-3 py-2 text-xs font-bold text-orange-800 shadow-sm disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      <section className="mb-4 rounded-3xl border border-orange-100 bg-white/80 p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-950">运营入口</h2>
          <span className="text-xs text-gray-400">饭团后台</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Link
          to="/feituan"
          className={quickLinkClass}
        >
          饭团主页
        </Link>
        <Link
          to="/admin/feituan/orders"
          className={quickLinkClass}
        >
          饭团订单
        </Link>
        <Link
          to="/admin/feituan/reconciliation"
          className={quickLinkClass}
        >
          饭团对账
        </Link>
        <Link
          to="/admin/feituan/wallet"
          className={quickLinkClass}
        >
          饭团钱包
        </Link>
        <Link
          to="/admin/feituan/delivery"
          className={quickLinkClass}
        >
          饭团配送
        </Link>
        <Link
          to="/admin/shops"
          className={quickLinkClass}
        >
          商户管理
        </Link>
      </div>
      </section>

      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-black text-gray-950">项目列表</h2>
        <span className="text-xs text-gray-500">共 {rows.length} 个</span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-orange-200 bg-white px-4 py-10 text-center text-sm text-gray-600">
          暂无饭团项目。
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5 rounded-2xl border border-orange-100 bg-white p-1 shadow-sm">
            {sections.map((section) => {
              const active = section.key === activeTab;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setActiveTab(section.key)}
                  className={`rounded-xl px-2 py-2 text-xs font-bold transition ${
                    active
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-transparent text-gray-600 active:bg-orange-50'
                  }`}
                >
                  <span className="block">{section.title}</span>
                  <span className={active ? 'text-white/80' : 'text-gray-400'}>
                    {section.rows.length}
                  </span>
                </button>
              );
            })}
          </div>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-black text-gray-950">
                {activeSection.title}（{activeSection.rows.length}）
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">{activeSection.hint}</p>
            </div>
            {activeSection.rows.length > 0 ? (
              <div className="space-y-3">{activeSection.rows.map(renderProjectCard)}</div>
            ) : (
              <div className="rounded-2xl border border-dashed border-orange-100 bg-white/70 px-4 py-5 text-center text-xs text-gray-400">
                暂无{activeSection.title}项目
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
