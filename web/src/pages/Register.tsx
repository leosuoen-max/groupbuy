import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  RecaptchaVerifier,
  signInAnonymously,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { PageShell } from '../components/PageShell';
import { getAuthClient } from '../lib/firebase';

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function normalizePhone(raw: string): string {
  const v = raw.replace(/\s+/g, '');
  if (v.startsWith('+')) return `+${v.slice(1).replace(/[^\d]/g, '')}`;
  const digits = v.replace(/[^\d]/g, '');
  if (!digits) return '';
  // 默认马来西亚区号
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return `+60${digits}`;
}

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const auth = getAuthClient();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const phoneE164 = useMemo(() => normalizePhone(phone), [phone]);

  useEffect(() => {
    return () => {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    };
  }, []);

  const ensureRecaptcha = () => {
    if (recaptchaRef.current) return recaptchaRef.current;
    const verifier = new RecaptchaVerifier(auth, 'register-recaptcha', {
      size: 'normal',
    });
    recaptchaRef.current = verifier;
    return verifier;
  };

  const sendCode = async () => {
    if (!phoneE164 || !phoneE164.startsWith('+')) {
      setMsg('请输入有效手机号（支持 012-xxx 或 +60xxx）');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const verifier = ensureRecaptcha();
      const result = await signInWithPhoneNumber(auth, phoneE164, verifier);
      setConfirmResult(result);
      setMsg(`验证码已发送到 ${phoneE164}`);
    } catch (e) {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
      setMsg(e instanceof Error ? e.message : '发送验证码失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    if (!confirmResult) {
      setMsg('请先发送验证码');
      return;
    }
    if (!code.trim()) {
      setMsg('请输入验证码');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await confirmResult.confirm(code.trim());
      navigate(returnTo, { replace: true });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '验证码校验失败');
    } finally {
      setBusy(false);
    }
  };

  const anon = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await signInAnonymously(auth);
      navigate(returnTo, { replace: true });
    } catch (e) {
      setMsg(
        e instanceof Error
          ? `${e.message}（请在 Firebase 控制台启用对应登录方式）`
          : '注册失败'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="注册" subtitle="手机号验证码">
      <div className="space-y-3">
        <label className="block text-sm text-gray-800">
          手机号
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="例如 0123456789 或 +60123456789"
            className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-indigo-300"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendCode()}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? '发送中…' : '发送验证码'}
        </button>

        <div id="register-recaptcha" className="overflow-hidden rounded-xl" />

        <label className="block text-sm text-gray-800">
          验证码
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入短信验证码"
            className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-indigo-300"
          />
        </label>
        <button
          type="button"
          disabled={busy || !confirmResult}
          onClick={() => void confirmCode()}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? '验证中…' : '确认注册并进入后台'}
        </button>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-600">
            若你当前环境未启用手机号登录，可先使用开发入口：
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void anon()}
            className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-800 disabled:opacity-60"
          >
            开发用：匿名注册并进入后台
          </button>
        </div>

        <Link
          to="/"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
        >
          返回首页
        </Link>
        {msg ? <p className="text-sm text-amber-700">{msg}</p> : null}
      </div>
    </PageShell>
  );
}
