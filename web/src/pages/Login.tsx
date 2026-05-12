import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const registerHref = `/register?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <PageShell title="登录" subtitle="手机号验证码">
      <p className="mb-4 text-sm text-gray-600">
        本站已关闭匿名登录。请使用<strong>手机号验证码</strong>登录；若尚无账号，同一流程即完成注册。
      </p>
      <Link
        to={registerHref}
        className="mb-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        手机号登录 / 注册
      </Link>
      <Link
        to="/"
        className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
      >
        返回首页
      </Link>
    </PageShell>
  );
}
