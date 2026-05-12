import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

/** 用户登录入口：仅引导至手机号验证；新账号在验证阶段会被拦截（见 Register）。 */
export default function Login() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const phoneLoginHref = `/register?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <PageShell title="用户登录" subtitle="仅限已有账号">
      <p className="mb-3 text-sm leading-relaxed text-gray-700">
        请使用<strong>已在平台登记过的手机号</strong>收取验证码并登录。本站已关闭<strong>公开自助注册</strong>。
      </p>
      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        新商户首次开通账号，仅可通过站长发放的<strong>一次性邀请链接</strong>完成注册；请勿在本页使用从未注册过的手机号尝试登录。
      </p>
      <Link
        to={phoneLoginHref}
        className="mb-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        手机号登录
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
