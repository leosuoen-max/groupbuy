import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { PageShell } from '../components/PageShell';
import { getAuthClient } from '../lib/firebase';

export default function Login() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const anon = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await signInAnonymously(getAuthClient());
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setMsg(
        e instanceof Error
          ? `${e.message}（请在 Firebase 控制台 → Authentication → 登录方式 → 启用「匿名」）`
          : '登录失败'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="登录" subtitle="正式版为手机号验证码 / Magic Link（见 docs/05）">
      <p className="mb-4 text-sm text-gray-600">
        开发阶段可先用匿名登录进入商户后台；生产环境请关闭匿名登录并接入手机号登录。
      </p>
      <button
        type="button"
        className="mb-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white disabled:bg-gray-400"
        disabled={busy}
        onClick={() => void anon()}
      >
        {busy ? '登录中…' : '开发用：匿名登录并进入后台'}
      </button>
      <Link
        to="/"
        className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
      >
        返回首页
      </Link>
      {msg ? <p className="mt-3 text-sm text-red-600">{msg}</p> : null}
    </PageShell>
  );
}
