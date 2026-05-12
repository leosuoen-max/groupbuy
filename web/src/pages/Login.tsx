import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { PageShell } from '../components/PageShell';
import { getAuthClient } from '../lib/firebase';

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const registerHref = `/register?returnTo=${encodeURIComponent(returnTo)}`;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState<string | null>(null);

  const handleEmailLogin = async () => {
    if (!email.trim() || !password) {
      setEmailErr('请填写邮箱与密码');
      return;
    }
    setEmailBusy(true);
    setEmailErr(null);
    try {
      await signInWithEmailAndPassword(getAuthClient(), email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : '邮箱登录失败');
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <PageShell title="登录" subtitle="手机号或备用邮箱">
      <p className="mb-4 text-sm text-gray-600">
        本站已关闭匿名登录。请使用<strong>手机号验证码</strong>登录；若尚无账号，同一流程即完成注册。
      </p>
      <Link
        to={registerHref}
        className="mb-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        手机号登录 / 注册
      </Link>
      <p className="mb-6 text-[11px] leading-relaxed text-gray-500">
        手机号建议用国际格式，例如 <strong>+8613800138000</strong>（中国）、<strong>+60123456789</strong>（马来西亚）；马国本地也可在下一页写{' '}
        <strong>01…</strong>。能否收短信以 Firebase 对该号码/地区的支持为准。
      </p>

      <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">备用：邮箱管理员</h2>
        <p className="mb-3 text-xs leading-relaxed text-gray-600">
          在 Firebase 控制台启用「电子邮件/密码」后，可在 <strong>Authentication</strong> 里手动添加带邮箱的管理员账号；登录后在 Firestore{' '}
          <code className="rounded bg-white px-1">platform_admins</code> 下以该用户 <strong>UID</strong> 为文档 ID
          新增一条，即可与手机号管理员并列。仅用于救急与双因子式备份，勿公开邮箱密码。
        </p>
        <label className="mb-2 block text-sm text-gray-800">
          邮箱
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-indigo-300"
          />
        </label>
        <label className="mb-3 block text-sm text-gray-800">
          密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-indigo-300"
          />
        </label>
        <button
          type="button"
          disabled={emailBusy}
          onClick={() => void handleEmailLogin()}
          className="h-10 w-full rounded-lg bg-gray-900 text-sm font-semibold text-white disabled:opacity-50"
        >
          {emailBusy ? '登录中…' : '邮箱登录'}
        </button>
        {emailErr ? <p className="mt-2 text-xs text-red-600">{emailErr}</p> : null}
      </div>

      <Link
        to="/"
        className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
      >
        返回首页
      </Link>
    </PageShell>
  );
}
