import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { getShopBySlug } from '../../lib/shopService';
import type { ShopRow } from '../../lib/shopService';

export default function MerchantDashboard() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const { user, loading: authLoading } = useAuthUser();
  const [shop, setShop] = useState<ShopRow | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        const row = await getShopBySlug(decodeURIComponent(shopSlug));
        if (!cancelled) setShop(row);
      } catch (e) {
        if (!cancelled) {
          setShop(null);
          setErr(e instanceof Error ? e.message : '加载失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopSlug]);

  if (authLoading || shop === undefined) {
    return (
      <PageShell title="店铺后台" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="店铺后台" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (err || !shop) {
    return (
      <PageShell title="店铺后台" subtitle="未找到店铺">
        <p className="text-sm text-gray-600">
          {err ?? '链接不存在或已被删除。'}
        </p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  if (shop.data.ownerId !== user.uid) {
    return (
      <PageShell title="店铺后台" subtitle="无权限">
        <p className="text-sm text-gray-600">你不是该店铺的创建人（当前为 mock 权限校验）。</p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回我的店铺
        </Link>
      </PageShell>
    );
  }

  const base = `/dashboard/${encodeURIComponent(shop.data.slug)}`;

  return (
    <PageShell title={shop.data.name} subtitle={`/${shop.data.slug}`}>
      <p className="mb-4 text-sm text-gray-600">
        今日数据、订单概览等后续再接 Firestore 统计；先完成项目发布闭环。
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Link
          to={`${base}/projects`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          项目列表
        </Link>
        <Link
          to={`${base}/orders`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          订单管理
        </Link>
        <Link
          to={`${base}/settings`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          店铺设置
        </Link>
        <Link
          to={`${base}/delivery-points`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          配送点
        </Link>
        <Link
          to={`${base}/admins`}
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-center text-sm font-medium text-gray-900 shadow-sm active:bg-gray-50"
        >
          管理员
        </Link>
        <Link
          to="/dashboard"
          className="flex min-h-[3.5rem] items-center justify-center rounded-xl border border-dashed border-gray-300 px-2 text-center text-sm font-medium text-gray-700"
        >
          切换店铺
        </Link>
      </div>
    </PageShell>
  );
}
