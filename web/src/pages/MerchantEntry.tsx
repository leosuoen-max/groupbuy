import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';

/**
 * 站点根路径：商户注册/登录入口（对外分享的主链接应指向本站根路径）。
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
        <p className="text-sm text-gray-600">正在进入商户后台…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-[70vh] w-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight text-gray-900">
          群购 · 商户中心
        </h1>
        <p className="mb-8 text-center text-sm leading-relaxed text-gray-600">
          注册或登录后管理店铺、团购项目与订单。顾客请使用商户分享的店铺链接进店，无需访问本页。
        </p>

        <div className="space-y-3">
          <Link
            to="/register"
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            注册开店（手机号）
          </Link>
          <Link
            to="/login"
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
          >
            登录
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
