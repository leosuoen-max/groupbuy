import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { createShopInvitation } from '../../lib/invitationService';
import {
  listShopAdminPermissions,
  removeProjectPermission,
  updateProjectPermissionRole,
  type PermissionRow,
} from '../../lib/permissionService';
import { getShopBySlug } from '../../lib/shopService';

function resolveInviteOrigin(): string {
  const envOrigin = (import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined)?.trim();
  if (envOrigin) return envOrigin.replace(/\/+$/, '');
  return window.location.origin;
}

export default function AdminManagement() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();

  const [err, setErr] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'high_admin' | 'normal_admin'>(
    'normal_admin'
  );
  const [busy, setBusy] = useState(false);
  const [permBusyId, setPermBusyId] = useState<string | null>(null);
  const [shopAdmins, setShopAdmins] = useState<PermissionRow[]>([]);
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
        setErr('仅店主可管理管理员邀请');
        return;
      }
      setShopId(shop.id);
      setShopName(shop.data.name);
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

  useEffect(() => {
    if (!shopId) {
      setShopAdmins([]);
      return;
    }
    let cancelled = false;
    void listShopAdminPermissions(shopId)
      .then((rows) => {
        if (!cancelled) setShopAdmins(rows);
      })
      .catch(() => {
        if (!cancelled) setShopAdmins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, busy]);

  const handleGenerate = async () => {
    if (!user || !shopId) {
      setErr('店铺未加载完成');
      return;
    }
    setBusy(true);
    setErr(null);
    setInviteUrl(null);
    try {
      const code = await createShopInvitation({
        shopId,
        role,
        invitedBy: user.uid,
      });
      const url = `${resolveInviteOrigin()}/invite/${encodeURIComponent(code)}`;
      setInviteUrl(url);
      if (/localhost|127\.0\.0\.1/.test(resolveInviteOrigin())) {
        setErr('当前生成的是本机地址（localhost），外部设备无法访问。请配置 VITE_PUBLIC_APP_ORIGIN 为可访问域名/IP。');
      }
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

  const handleChangeRole = async (
    p: PermissionRow,
    nextRole: 'normal_admin' | 'high_admin'
  ) => {
    if (p.data.role === nextRole) return;
    const roleLabel = nextRole === 'high_admin' ? '高级管理员' : '普通管理员';
    if (!confirm(`确认将该管理员改为「${roleLabel}」？`)) return;
    setPermBusyId(p.id);
    setErr(null);
    try {
      await updateProjectPermissionRole({
        permissionId: p.id,
        role: nextRole,
      });
      if (!shopId) return;
      const rows = await listShopAdminPermissions(shopId);
      setShopAdmins(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '修改角色失败');
    } finally {
      setPermBusyId(null);
    }
  };

  const handleRemovePermission = async (p: PermissionRow) => {
    if (!confirm('确认将该管理员移出店铺管理员列表？')) return;
    setPermBusyId(p.id);
    setErr(null);
    try {
      await removeProjectPermission(p.id);
      if (!shopId) return;
      const rows = await listShopAdminPermissions(shopId);
      setShopAdmins(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '移除失败');
    } finally {
      setPermBusyId(null);
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

  return (
    <PageShell
      title="管理员管理"
      subtitle={`${shopName} · 邀请链接 24 小时内有效`}
    >
      {err ? (
        <p className="mb-3 text-sm text-amber-800">{err}</p>
      ) : null}

      <>
          <p className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            受邀管理员由店主在「管理员管理」中邀请；接受邀请后，可按角色管理本店<strong>所有项目</strong>。
            普通管理员以订单与对账为主；高级管理员可改项目与店铺设置（不可增删管理员）。
          </p>

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
              高级管理员（除「管理员管理」外，与店主权限相同）
            </label>
          </fieldset>

          <button
            type="button"
            disabled={busy}
            className="mb-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300"
            onClick={() => void handleGenerate()}
          >
            {busy ? '生成中…' : '邀请加入店铺管理员'}
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

          <section className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              店铺管理员列表 <span className="text-xs text-gray-500">{shopAdmins.length} 人</span>
            </h3>
            {shopAdmins.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
                当前店铺暂无受邀管理员。
              </p>
            ) : (
              <div className="space-y-2">
                {shopAdmins.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">
                          用户 {p.data.userId.slice(-8)}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          授权时间：
                          {p.data.grantedAt?.toDate?.().toLocaleString?.() ?? '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs"
                          value={p.data.role}
                          disabled={permBusyId === p.id}
                          onChange={(e) =>
                            void handleChangeRole(
                              p,
                              e.target.value as 'normal_admin' | 'high_admin'
                            )
                          }
                        >
                          <option value="normal_admin">普通管理员</option>
                          <option value="high_admin">高级管理员</option>
                        </select>
                        <button
                          type="button"
                          className="h-8 rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs font-medium text-rose-700 disabled:opacity-50"
                          disabled={permBusyId === p.id}
                          onClick={() => void handleRemovePermission(p)}
                        >
                          {permBusyId === p.id ? '处理中…' : '移出店铺'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
      </>

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
