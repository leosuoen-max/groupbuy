import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { PageShell } from '../../components/PageShell';
import { getAuthClient } from '../../lib/firebase';
import { createShop, listShopsByOwner, type ShopRow } from '../../lib/shopService';
import { useAuthUser } from '../../hooks/useAuthUser';

/** 6–20 位：小写字母/数字/横线，不以横线开头或结尾 */
const slugHint = /^[a-z0-9][a-z0-9-]{4,18}[a-z0-9]$/;

export default function ShopList() {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [anonBusy, setAnonBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setListLoading(true);
    setMsg(null);
    try {
      setShops(await listShopsByOwner(user.uid));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '加载店铺失败');
    } finally {
      setListLoading(false);
    }
  }, [user]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handleAnon = async () => {
    setAnonBusy(true);
    setMsg(null);
    try {
      await signInAnonymously(getAuthClient());
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setMsg(
        e instanceof Error
          ? `${e.message}（请在 Firebase 控制台启用「匿名登录」）`
          : '匿名登录失败'
      );
    } finally {
      setAnonBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!user) return;
    const s = slug.trim().toLowerCase();
    const n = name.trim();
    if (!n) {
      setMsg('请填写店名');
      return;
    }
    if (!slugHint.test(s)) {
      setMsg('链接只能用小写字母、数字、横线，6–20 位，且不能以横线开头或结尾。');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await createShop(user.uid, { name: n, slug: s });
      setName('');
      setSlug('');
      await refresh();
    } catch (e) {
      if (e instanceof Error && e.message === 'SLUG_TAKEN') {
        setMsg('该链接已被占用，请换一个。');
      } else {
        setMsg(e instanceof Error ? e.message : '创建失败');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <PageShell title="我的店铺" subtitle="加载中…">
        <p className="text-sm text-gray-600">正在检查登录状态…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="我的店铺" subtitle="需要登录">
        <p className="mb-4 text-sm text-gray-600">
          商户后台需要先登录。开发阶段可使用 Firebase「匿名登录」；正式环境将改为手机号验证码（见 docs/05）。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white disabled:bg-gray-400"
            disabled={anonBusy}
            onClick={() => void handleAnon()}
          >
            {anonBusy ? '登录中…' : '开发用：匿名登录'}
          </button>
          <Link
            to="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
          >
            去登录页
          </Link>
        </div>
        {msg ? <p className="mt-3 text-sm text-red-600">{msg}</p> : null}
      </PageShell>
    );
  }

  return (
    <PageShell title="我的店铺" subtitle="选择店铺进入后台，或新建一家店">
      {msg ? <p className="mb-3 text-sm text-red-600">{msg}</p> : null}

      <section className="mb-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">新建店铺</h2>
        <label className="mb-2 block text-sm text-gray-700">
          店名
          <input
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：辉姐家常小厨"
          />
        </label>
        <label className="mb-3 block text-sm text-gray-700">
          店铺链接（小写、横线）
          <div className="mt-1 flex items-center gap-1 text-[16px]">
            <span className="shrink-0 text-gray-500">/shop/</span>
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="huijie"
            />
          </div>
        </label>
        <button
          type="button"
          className="h-11 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300"
          disabled={busy}
          onClick={() => void handleCreate()}
        >
          {busy ? '创建中…' : '创建店铺'}
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">我的店铺</h2>
        {listLoading ? (
          <p className="text-sm text-gray-600">加载中…</p>
        ) : shops.length === 0 ? (
          <p className="text-sm text-gray-600">还没有店铺，先在上面创建一个。</p>
        ) : (
          <ul className="space-y-2">
            {shops.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/dashboard/${encodeURIComponent(s.data.slug)}`}
                  className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm shadow-sm active:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{s.data.name}</span>
                  <span className="text-xs text-gray-500">/{s.data.slug}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
