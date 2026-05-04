import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { createDraftProject, listProjectsByShopId, type ProjectRow } from '../../lib/projectService';
import { getShopBySlug } from '../../lib/shopService';

function statusLabel(s: ProjectRow['data']['status']) {
  if (s === 'draft') return '草稿';
  if (s === 'published') return '已发布';
  return '已截止';
}

export default function ProjectList() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const { user, loading: authLoading } = useAuthUser();
  const navigate = useNavigate();
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const slug = decodeURIComponent(shopSlug);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setShopId(null);
        setProjects([]);
        setErr('店铺不存在');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setShopId(null);
        setProjects([]);
        setErr('无权限访问该店铺');
        return;
      }
      setShopId(shop.id);
      setShopName(shop.data.name);
      setProjects(await listProjectsByShopId(shop.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [slug, user]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!authLoading && user) {
        void refresh();
      } else if (!authLoading && !user) {
        setLoading(false);
      }
    });
  }, [authLoading, user, refresh]);

  const handleNew = async () => {
    if (!shopId) return;
    setCreating(true);
    setErr(null);
    try {
      const id = await createDraftProject(shopId);
      navigate(
        `/dashboard/${encodeURIComponent(slug)}/projects/${encodeURIComponent(id)}`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  if (authLoading || (user && loading)) {
    return (
      <PageShell title="项目列表" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="项目列表" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (err && !shopId) {
    return (
      <PageShell title="项目列表" subtitle="错误">
        <p className="text-sm text-red-600">{err}</p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  const base = `/dashboard/${encodeURIComponent(slug)}`;

  return (
    <PageShell title="项目列表" subtitle={shopName}>
      {err ? <p className="mb-2 text-sm text-amber-800">{err}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
          disabled={creating || !shopId}
          onClick={() => void handleNew()}
        >
          {creating ? '创建中…' : '+ 新建项目（草稿）'}
        </button>
        <Link
          to={base}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          返回 Dashboard
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-600">还没有项目，点上方新建。</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to={`${base}/projects/${encodeURIComponent(p.id)}`}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm shadow-sm"
              >
                <span className="min-w-0 truncate font-medium text-gray-900">
                  {p.data.title || '未命名'}
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {statusLabel(p.data.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
