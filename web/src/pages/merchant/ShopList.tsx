import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import {
  createShop,
  getPrimaryShop,
  listShopsByOwner,
  type ShopRow,
} from '../../lib/shopService';
import { userHasConsumedSignupInvite } from '../../lib/signupInviteService';
import { useAuthUser } from '../../hooks/useAuthUser';

function randomBase36(len: number): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/g, '')
    .slice(0, len);
}

/** 短链接：固定前缀 + 时间片 + 随机片段，长度约 9-11 */
function genShortSlug(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = randomBase36(5).padEnd(5, 'x');
  return `s${ts}${rand}`;
}

export default function ShopList() {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [name, setName] = useState('');
  const [canInitializeShop, setCanInitializeShop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setListLoading(true);
    setMsg(null);
    try {
      const [shopRows, invited] = await Promise.all([
        listShopsByOwner(user.uid),
        userHasConsumedSignupInvite(user.uid),
      ]);
      setShops(shopRows);
      setCanInitializeShop(invited);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '加载失败');
    } finally {
      setListLoading(false);
    }
  }, [user]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!user || listLoading) return;
    const primary = getPrimaryShop(shops);
    if (primary) {
      navigate(`/dashboard/${encodeURIComponent(primary.data.slug)}`, {
        replace: true,
      });
    }
  }, [user, listLoading, shops, navigate]);

  const handleCreate = async () => {
    if (!user) return;
    const n = name.trim();
    if (!n) {
      setMsg('请填写商户名称');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      let created = false;
      for (let i = 0; i < 6; i++) {
        const slug = genShortSlug();
        try {
          await createShop(user.uid, { name: n, slug });
          created = true;
          break;
        } catch (err) {
          if (!(err instanceof Error) || err.message !== 'SLUG_TAKEN') {
            throw err;
          }
        }
      }
      if (!created) {
        throw new Error('自动生成链接失败，请重试');
      }
      setName('');
      await refresh();
    } catch (e) {
      if (e instanceof Error && e.message === 'OWNER_ALREADY_HAS_SHOP') {
        setMsg('当前账号已有商户资料，正在跳转…');
        await refresh();
      } else if (e instanceof Error && e.message === 'MERCHANT_INVITE_REQUIRED') {
        setMsg('该账号没有商户开通资格。新商户请先使用平台管理员生成的一次性注册链接。');
      } else {
        setMsg(e instanceof Error ? e.message : '创建失败');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <PageShell title="商户后台" subtitle="加载中…">
        <p className="text-sm text-gray-600">正在检查登录状态…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="商户后台" subtitle="需要登录">
        <p className="mb-4 text-sm leading-relaxed text-gray-600">
          商户后台需先登录。<strong>已有账号</strong>请用手机号验证码；新商户首次开通请向站长索取<strong>一次性邀请链接</strong>（公开页不可自助注册新账号）。
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            to="/register?returnTo=%2Fdashboard"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white"
          >
            手机号登录（已有账号）
          </Link>
          <Link
            to="/login?returnTo=%2Fdashboard"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
          >
            登录说明页
          </Link>
        </div>
        {msg ? <p className="mt-3 text-sm text-red-600">{msg}</p> : null}
      </PageShell>
    );
  }

  if (listLoading) {
    return (
      <PageShell title="商户后台" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (getPrimaryShop(shops)) {
    return (
      <PageShell title="商户后台" subtitle="正在进入…">
        <p className="text-sm text-gray-600">正在打开后台…</p>
      </PageShell>
    );
  }

  if (!canInitializeShop) {
    return (
      <PageShell title="商户后台" subtitle="尚未开通商户">
        {msg ? <p className="mb-3 text-sm text-red-600">{msg}</p> : null}
        <section className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-950">
            这个手机号账号还不是商户
          </h2>
          <p className="text-sm leading-relaxed text-amber-950">
            饭团顾客账号可以用于钱包和订单，但不能自行开通商户后台。新商户首次开通必须使用平台管理员生成的一次性注册链接，或由平台管理员在后台为 UID 创建商户。
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link
              to="/"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-amber-200 bg-white px-4 text-sm font-medium text-amber-950"
            >
              返回商户入口
            </Link>
            <Link
              to="/feituan"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white"
            >
              返回大马饭团
            </Link>
          </div>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell title="商户后台" subtitle="已通过一次性链接开通；首次使用请设置名称">
      {msg ? <p className="mb-3 text-sm text-red-600">{msg}</p> : null}

      <section className="mb-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">完成初始化</h2>
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          系统会自动生成公开链接（短链接），形如{' '}
          <code className="rounded bg-white px-1">
            /shop/<span className="text-emerald-700">s8k2ab9x</span>/项目…
          </code>
          ，与具体卖什么无关；不同品类请创建不同<strong>项目</strong>即可。
        </p>
        <label className="mb-2 block text-sm text-gray-700">
          商户名称（对内展示）
          <input
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：辉姐团购组"
          />
        </label>
        <button
          type="button"
          className="h-11 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300"
          disabled={busy}
          onClick={() => void handleCreate()}
        >
          {busy ? '创建中…' : '创建并进入后台'}
        </button>
      </section>
    </PageShell>
  );
}
