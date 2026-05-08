import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  acceptProjectInvitation,
  getInvitationByCode,
} from '../lib/invitationService';
import { getProject } from '../lib/projectService';
import { getShopById } from '../lib/shopService';

type InviteMeta = {
  projectId?: string;
  shopSlug: string;
  roleLabel: string;
  projectTitle: string;
  shopName: string;
  scope: 'shop' | 'project';
};

export default function InviteAccept() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();

  const [boot, setBoot] = useState<'loading' | 'bad' | 'ready'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<InviteMeta | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr(null);
      const row = await getInvitationByCode(code);
      if (cancelled) return;
      if (!row) {
        setBoot('bad');
        setErr('邀请不存在');
        return;
      }
      if (row.data.usedBy) {
        setBoot('bad');
        setErr('该邀请已被使用');
        return;
      }
      if (row.data.expiresAt.toMillis() < Date.now()) {
        setBoot('bad');
        setErr('邀请已过期（24 小时内有效）');
        return;
      }
      const proj = row.data.projectId ? await getProject(row.data.projectId) : null;
      const shop = row.data.shopId
        ? await getShopById(row.data.shopId)
        : proj
          ? await getShopById(proj.data.shopId)
          : null;
      if (cancelled) return;
      if (!shop || (row.data.scope === 'project' && !proj)) {
        setBoot('bad');
        setErr('项目或店铺不存在');
        return;
      }
      setMeta({
        projectId: proj?.id,
        shopSlug: shop.data.slug,
        roleLabel:
          row.data.role === 'high_admin' ? '高级管理员' : '普通管理员',
        projectTitle:
          row.data.scope === 'shop'
            ? '店铺管理员邀请'
            : proj?.data.title?.trim() || '（项目）',
        shopName: shop.data.name,
        scope: row.data.scope,
      });
      setBoot('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleAccept = async () => {
    if (!user || !meta) return;
    setAccepting(true);
    setErr(null);
    try {
      await acceptProjectInvitation(code, user.uid);
      if (meta.scope === 'project' && meta.projectId) {
        navigate(
          `/shop/${encodeURIComponent(meta.shopSlug)}/${encodeURIComponent(meta.projectId)}`,
          { replace: true }
        );
        return;
      }
      navigate(`/dashboard/${encodeURIComponent(meta.shopSlug)}`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '接受失败');
    } finally {
      setAccepting(false);
    }
  };

  const loginHref = `/login?returnTo=${encodeURIComponent(`/invite/${encodeURIComponent(code)}`)}`;

  if (boot === 'loading') {
    return (
      <PageShell title="管理员邀请" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (boot === 'bad') {
    return (
      <PageShell title="管理员邀请" subtitle="无法接受">
        <p className="text-sm text-red-600">{err ?? '邀请无效'}</p>
        <Link
          className="mt-4 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to="/"
        >
          返回首页
        </Link>
      </PageShell>
    );
  }

  if (boot === 'ready' && !authLoading && !user && meta) {
    return (
      <PageShell title="管理员邀请" subtitle={meta.projectTitle}>
        <p className="mb-2 text-sm text-gray-700">
          {meta.shopName} · 邀请你为 <strong>{meta.roleLabel}</strong>
        </p>
        <p className="mb-4 text-sm text-gray-600">请先登录后再接受邀请。</p>
        <Link
          to={loginHref}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white"
        >
          去登录
        </Link>
      </PageShell>
    );
  }

  if (boot === 'ready' && authLoading) {
    return (
      <PageShell title="管理员邀请" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!meta) {
    return (
      <PageShell title="管理员邀请" subtitle="错误">
        <p className="text-sm text-red-600">数据异常</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="管理员邀请" subtitle={meta.projectTitle}>
      <p className="mb-2 text-sm text-gray-700">{meta.shopName}</p>
      <p className="mb-4 text-sm text-gray-600">
        邀请角色：<strong>{meta.roleLabel}</strong>
      </p>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      <button
        type="button"
        disabled={accepting || !user}
        className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300"
        onClick={() => void handleAccept()}
      >
        {accepting ? '处理中…' : '接受邀请'}
      </button>
      <Link
        to="/"
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
      >
        取消
      </Link>
    </PageShell>
  );
}
