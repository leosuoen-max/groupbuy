import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { createProjectInvitation } from '../../lib/invitationService';
import {
  listProjectsByShopId,
  type ProjectRow,
} from '../../lib/projectService';
import { getShopBySlug } from '../../lib/shopService';

export default function AdminManagement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();

  const [err, setErr] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<'high_admin' | 'normal_admin'>(
    'normal_admin'
  );
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const shop = await getShopBySlug(slug);
      if (!shop) {
        setShopId(null);
        setErr('未找到该商户链接');
        return;
      }
      if (shop.data.ownerId !== user.uid) {
        setShopId(null);
        setErr('仅店铺创建人可生成管理员邀请');
        return;
      }
      setShopId(shop.id);
      setShopName(shop.data.name);
      const list = await listProjectsByShopId(shop.id);
      setProjects(list);
      setProjectId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0]?.id ?? '';
      });
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

  const handleGenerate = async () => {
    if (!user || !shopId || !projectId) {
      setErr('请选择项目');
      return;
    }
    setBusy(true);
    setErr(null);
    setInviteUrl(null);
    try {
      const code = await createProjectInvitation({
        projectId,
        shopId,
        role,
        invitedBy: user.uid,
      });
      const url = `${window.location.origin}/invite/${encodeURIComponent(code)}`;
      setInviteUrl(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const base = `/dashboard/${encodeURIComponent(slug)}`;

  if (authLoading || (user && loading)) {
    return (
      <PageShell title="管理员管理" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="管理员管理" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  if (err && !shopId) {
    return (
      <PageShell title="管理员管理" subtitle="错误">
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

  const input =
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

  return (
    <PageShell
      title="管理员管理"
      subtitle={`${shopName} · 邀请链接 24 小时内有效`}
    >
      {err ? (
        <p className="mb-3 text-sm text-amber-800">{err}</p>
      ) : null}

      {projects.length === 0 ? (
        <p className="text-sm text-gray-600">
          暂无项目，请先到「项目列表」创建一个草稿或已发布项目。
        </p>
      ) : (
        <>
          <label className="mb-3 block text-sm text-gray-800">
            选择项目（链接）
            <select
              className={input}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.data.title?.trim() || '未命名'}（
                  {p.data.status === 'draft'
                    ? '草稿'
                    : p.data.status === 'published'
                      ? '已发布'
                      : '已截止'}
                  ）
                </option>
              ))}
            </select>
          </label>

          <fieldset className="mb-4 text-sm text-gray-800">
            <legend className="mb-2 font-medium">权限级别</legend>
            <label className="mr-4 cursor-pointer">
              <input
                type="radio"
                name="role"
                className="mr-1"
                checked={role === 'normal_admin'}
                onChange={() => setRole('normal_admin')}
              />
              普通管理员（订单与对账为主）
            </label>
            <label className="cursor-pointer">
              <input
                type="radio"
                name="role"
                className="mr-1"
                checked={role === 'high_admin'}
                onChange={() => setRole('high_admin')}
              />
              高级管理员（可改菜单与设置）
            </label>
          </fieldset>

          <button
            type="button"
            disabled={busy || !projectId}
            className="mb-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300"
            onClick={() => void handleGenerate()}
          >
            {busy ? '生成中…' : '生成邀请链接'}
          </button>

          {inviteUrl ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3 text-sm">
              <div className="mb-2 font-medium text-emerald-900">
                将以下链接发给对方（单次有效，接受后失效）
              </div>
              <div className="break-all font-mono text-xs text-gray-800">
                {inviteUrl}
              </div>
              <button
                type="button"
                className="mt-2 text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
                onClick={() => void handleCopy()}
              >
                {copied ? '已复制' : '复制链接'}
              </button>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          to={base}
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          ← 返回后台
        </Link>
        <Link
          to={`${base}/projects`}
          className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
        >
          项目列表
        </Link>
      </div>
    </PageShell>
  );
}
