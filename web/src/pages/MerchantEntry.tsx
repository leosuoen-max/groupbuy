import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { getCustomShopContactLine } from '../config/siteContact';

/**
 * 站点根路径：默认面向顾客说明；已登录用户进入后台或店铺相关流程。
 */
export default function MerchantEntry() {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <main className="flex min-h-[60vh] w-full flex-col items-center justify-center px-4">
        <p className="text-sm text-gray-500">加载中…</p>
      </main>
    );
  }

  if (user) {
    return (
      <main className="flex min-h-[60vh] w-full flex-col items-center justify-center px-4">
        <p className="text-sm text-gray-600">正在进入…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-[70vh] w-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight text-gray-900">
          群购
        </h1>
        <p className="mb-6 text-center text-sm leading-relaxed text-gray-600">
          请使用商户分享的店铺链接进店选购。本页不提供自助开店；若需定制店铺或商户服务，请通过下方方式联系。
        </p>

        <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-center">
          <p className="text-sm font-medium text-emerald-950">想定制自己的店？立即联系</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-emerald-900">
            {getCustomShopContactLine()}
          </p>
        </div>

        <div className="space-y-3">
          <Link
            to="/login"
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50"
          >
            商户登录（已有账号）
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-gray-500">
          <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/home">
            链接汇总与说明
          </Link>
          <span className="mx-1 text-gray-300">·</span>
          <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/invite/demo-code">
            邀请码示例
          </Link>
        </p>
      </div>
    </main>
  );
}
