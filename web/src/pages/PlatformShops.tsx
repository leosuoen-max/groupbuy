import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { getRegisteredUserPhoneMasked, isPlatformAdmin } from '../lib/registeredUserService';
import { createSignupInvite } from '../lib/signupInviteService';
import {
  listAllShopsForPlatform,
  setShopFeituanEnabledForPlatform,
  setShopActiveForPlatform,
  type ShopRow,
} from '../lib/shopService';

function fmtTsParts(t: { toDate?: () => Date } | null | undefined): {
  date: string;
  time: string;
} {
  if (!t?.toDate) return { date: '—', time: '' };
  try {
    const d = t.toDate();
    return {
      date: d.toLocaleDateString('zh-CN', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
      }),
      time: d.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  } catch {
    return { date: '—', time: '' };
  }
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
      营业
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
      停用
    </span>
  );
}

function FeituanPill({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
      已开通
    </span>
  ) : (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
      未开通
    </span>
  );
}

export default function PlatformShops() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ShopRow[]>([]);
  /** ownerId → 脱敏手机（来自 registered_users，店主需至少登录过一次） */
  const [ownerPhoneMasked, setOwnerPhoneMasked] = useState<Record<string, string | null>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
        setOwnerPhoneMasked({});
        return;
      }
      const shopRows = await listAllShopsForPlatform(user.uid);
      setRows(shopRows);
      const ownerIds = [...new Set(shopRows.map((r) => r.data.ownerId).filter(Boolean))];
      const pairs = await Promise.all(
        ownerIds.map(async (oid) => {
          const masked = await getRegisteredUserPhoneMasked(oid);
          return [oid, masked] as const;
        })
      );
      setOwnerPhoneMasked(Object.fromEntries(pairs));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '加载失败');
      setRows([]);
      setOwnerPhoneMasked({});
    } finally {
      setBusy(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
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

  const toggleFeituan = async (shop: ShopRow, next: boolean) => {
    if (!user) return;
    setBusy(true);
    setLoadErr(null);
    try {
      await setShopFeituanEnabledForPlatform(user.uid, shop.id, next);
      await refresh();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '更新失败');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <PageShell title="商户管理" subtitle="平台后台" hideBack>
        <p className="text-sm text-gray-600">加载中…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="商户管理" subtitle="平台后台" hideBack>
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

  if (allowed === null) {
    return (
      <PageShell title="商户管理" subtitle="平台后台" hideBack>
        <p className="text-sm text-gray-600">加载中…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="商户管理" subtitle="平台后台" hideBack>
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
    <PageShell title="商户管理" subtitle="创建 / 列表 / 停用或启用" hideBack>
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
          <Link
            to="/admin/feituan"
            className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-900 hover:bg-orange-100"
          >
            饭团管理
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

      {loadErr ? <p className="mb-3 text-sm text-red-600">{loadErr}</p> : null}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          暂无商户。
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const open = r.data.isActive !== false;
            const feituan = r.data.feituanEnabled === true;
            const dash = `/dashboard/${encodeURIComponent(r.data.slug)}`;
            const created = fmtTsParts(r.data.createdAt);
            return (
              <article
                key={r.id}
                className="rounded-2xl border border-gray-100 bg-white p-3 text-sm shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="line-clamp-2 text-base font-bold leading-tight text-gray-950">
                      {r.data.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                        {r.data.slug}
                      </code>
                      <Link
                        to={dash}
                        className="font-medium text-indigo-600 underline-offset-2 hover:underline"
                      >
                        打开后台
                      </Link>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill active={open} />
                    <FeituanPill enabled={feituan} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <div>
                    <p className="text-[11px] text-gray-400">店主 UID</p>
                    <p className="font-mono text-[11px] text-gray-800" title={r.data.ownerId}>
                      …{r.data.ownerId.slice(-8)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400">手机</p>
                    <p className="font-semibold text-gray-800">
                      {ownerPhoneMasked[r.data.ownerId] ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400">创建</p>
                    <p className="font-semibold text-gray-800">{created.date}</p>
                    {created.time ? <p className="text-[11px] text-gray-500">{created.time}</p> : null}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {open ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
                      onClick={() => void toggleActive(r, false)}
                    >
                      停用
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                      onClick={() => void toggleActive(r, true)}
                    >
                      启用
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-900 disabled:opacity-50"
                    onClick={() => void toggleFeituan(r, !feituan)}
                  >
                    {feituan ? '关闭饭团' : '开通饭团'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

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
