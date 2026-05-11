import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { isPlatformAdmin } from '../lib/registeredUserService';
import { createSignupInvite } from '../lib/signupInviteService';
import {
  createShopByPlatformAdmin,
  listAllShopsForPlatform,
  setShopActiveForPlatform,
  type ShopRow,
} from '../lib/shopService';

function randomBase36(len: number): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/g, '')
    .slice(0, len);
}

function genShortSlug(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = randomBase36(5).padEnd(5, 'x');
  return `s${ts}${rand}`;
}

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

export default function PlatformShops() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ShopRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ownerUid, setOwnerUid] = useState('');
  const [newName, setNewName] = useState('');
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setLoadErr(null);
    try {
      const ok = await isPlatformAdmin(user.uid);
      setAllowed(ok);
      if (!ok) {
        setRows([]);
        return;
      }
      setRows(await listAllShopsForPlatform(user.uid));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAllowed(false);
      setRows([]);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  const handleGenInviteLink = async () => {
    if (!user) return;
    setBusy(true);
    setInviteMsg(null);
    setInviteLink(null);
    try {
      const token = await createSignupInvite(user.uid);
      const url = `${window.location.origin}/invite-register/${encodeURIComponent(token)}`;
      setInviteLink(url);
      setInviteMsg('已生成一次性链接（7 天内有效）。');
      try {
        await navigator.clipboard.writeText(url);
        setInviteMsg('已生成并已复制到剪贴板（7 天内有效）。对方验证手机号成功后，链接即失效。');
      } catch {
        setInviteMsg('已生成（7 天内有效）。请手动复制下方链接发给对方。');
      }
    } catch (e) {
      setInviteMsg(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!user) return;
    const oid = ownerUid.trim();
    const n = newName.trim();
    if (!oid) {
      setCreateMsg('请填写店主 Firebase UID（对方需先注册/登录过一次）。');
      return;
    }
    if (!n) {
      setCreateMsg('请填写商户名称。');
      return;
    }
    setBusy(true);
    setCreateMsg(null);
    try {
      let created = false;
      for (let i = 0; i < 8; i++) {
        const slug = genShortSlug();
        try {
          await createShopByPlatformAdmin(user.uid, oid, { name: n, slug });
          created = true;
          break;
        } catch (err) {
          if (!(err instanceof Error) || err.message !== 'SLUG_TAKEN') {
            throw err;
          }
        }
      }
      if (!created) throw new Error('短链接生成失败，请重试');
      setOwnerUid('');
      setNewName('');
      setCreateMsg('已创建商户。');
      await refresh();
    } catch (e) {
      if (e instanceof Error && e.message === 'OWNER_ALREADY_HAS_SHOP') {
        setCreateMsg('该 UID 已绑定过一个商户（一账号一店）。');
      } else if (e instanceof Error && e.message === 'PLATFORM_ADMIN_REQUIRED') {
        setCreateMsg('无平台管理员权限。');
      } else {
        setCreateMsg(e instanceof Error ? e.message : '创建失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (shop: ShopRow, next: boolean) => {
    if (!user) return;
    setBusy(true);
    setLoadErr(null);
    try {
      await setShopActiveForPlatform(user.uid, shop.id, next);
      await refresh();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '更新失败');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || allowed === null) {
    return (
      <PageShell title="商户管理" subtitle="平台后台">
        <p className="text-sm text-gray-600">加载中…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="商户管理" subtitle="平台后台">
        <p className="mb-4 text-sm text-gray-700">请先登录后再访问。</p>
        <Link
          className="text-indigo-600 underline-offset-2 hover:underline"
          to="/login?returnTo=/admin/shops"
        >
          去登录
        </Link>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="商户管理" subtitle="平台后台">
        <p className="mb-3 text-sm text-gray-700">
          当前账号无权访问。请在 Firebase 控制台创建集合{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">platform_admins</code> ，并以你的 UID
          为文档 ID 新增一条空文档。
        </p>
        <p className="mb-2 text-xs text-gray-500">
          你的 UID：{' '}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs">{user.uid}</code>
        </p>
        <Link to="/" className="text-sm text-indigo-600 underline-offset-2 hover:underline">
          返回首页
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="商户管理" subtitle="创建 / 列表 / 停用或启用">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-600">
          停用后顾客无法进店与下单；店主仍可在商户后台查看与处理历史数据。
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/registrations"
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            用户登记
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
          >
            {busy ? '处理中…' : '刷新'}
          </button>
        </div>
      </div>

      <section className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">一次性注册链接</h2>
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          生成链接发给对方；对方在本页完成<strong>手机号验证码注册</strong>后，链接即作废（不可重复使用）。注册成功后会进入
          <code className="mx-0.5 rounded bg-white px-1">/dashboard</code>
          ，可再创建商户资料。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleGenInviteLink()}
          className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
        >
          生成并复制链接
        </button>
        {inviteMsg ? (
          <p className="mt-2 text-xs text-indigo-950" role="status">
            {inviteMsg}
          </p>
        ) : null}
        {inviteLink ? (
          <div className="mt-2">
            <label className="mb-1 block text-[11px] font-medium text-gray-600">链接（勿公开发布）</label>
            <textarea
              readOnly
              rows={2}
              className="w-full resize-y rounded-lg border border-gray-200 bg-white p-2 font-mono text-[11px] text-gray-800"
              value={inviteLink}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : null}
      </section>

      <section className="mb-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">新建商户（UID）</h2>
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          若对方<strong>已有</strong> Firebase 账号：可复制其 UID 填入下方。若希望对方自助用手机号注册，优先使用上方「一次性注册链接」。
        </p>
        <label className="mb-2 block text-sm text-gray-700">
          店主 UID
          <input
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
            value={ownerUid}
            onChange={(e) => setOwnerUid(e.target.value)}
            placeholder="例如：AbC123…（Firebase 控制台 Authentication 可复制）"
            disabled={busy}
          />
        </label>
        <label className="mb-3 block text-sm text-gray-700">
          商户名称（对内）
          <input
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例如：某某团购组"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleCreate()}
          className="h-10 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300 sm:w-auto sm:px-6"
        >
          创建商户
        </button>
        {createMsg ? (
          <p className="mt-2 text-xs text-amber-800" role="status">
            {createMsg}
          </p>
        ) : null}
      </section>

      {loadErr ? <p className="mb-3 text-sm text-red-600">{loadErr}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-3 py-2 font-semibold">名称</th>
              <th className="px-3 py-2 font-semibold">slug / 后台</th>
              <th className="px-3 py-2 font-semibold">店主 UID</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">状态</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">创建</th>
              <th className="px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  暂无商户。
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const open = r.data.isActive !== false;
                const dash = `/dashboard/${encodeURIComponent(r.data.slug)}`;
                return (
                  <tr key={r.id} className="hover:bg-gray-50/80">
                    <td className="px-3 py-2 font-medium">{r.data.name}</td>
                    <td className="px-3 py-2">
                      <code className="rounded bg-gray-100 px-1">{r.data.slug}</code>
                      <div className="mt-1">
                        <Link
                          to={dash}
                          className="text-indigo-600 underline-offset-2 hover:underline"
                        >
                          打开后台
                        </Link>
                      </div>
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" title={r.data.ownerId}>
                      …{r.data.ownerId.slice(-8)}
                    </td>
                    <td className="px-3 py-2">
                      {open ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">营业</span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-800">停用</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                      {fmtTs(r.data.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {open ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 disabled:opacity-50"
                          onClick={() => void toggleActive(r, false)}
                        >
                          停用
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-900 disabled:opacity-50"
                          onClick={() => void toggleActive(r, true)}
                        >
                          启用
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 space-y-2 text-xs text-gray-500">
        <p>
          当前登录账号 UID（便于核对白名单）：{' '}
          <code className="rounded bg-gray-100 px-1 font-mono">{user.uid}</code>
        </p>
        <Link to="/" className="text-sm text-indigo-600 underline-offset-2 hover:underline">
          返回首页
        </Link>
      </div>
    </PageShell>
  );
}
