import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { getAuthClient } from '../lib/firebase';

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/feituan/wallet';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/feituan/wallet';
  return raw;
}

function normalizePhone(raw: string): string {
  const v = raw.replace(/\s+/g, '');
  if (v.startsWith('+')) return `+${v.slice(1).replace(/[^\d]/g, '')}`;
  const digits = v.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return `+60${digits}`;
}

export default function FeituanAccount() {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const returnTo = safeReturnTo(search.get('returnTo'));
  const auth = getAuthClient();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const phoneE164 = useMemo(() => normalizePhone(phone), [phone]);

  useEffect(() => {
    if (!loading && user?.phoneNumber) {
      navigate(returnTo, { replace: true });
    }
  }, [loading, navigate, returnTo, user?.phoneNumber]);

  useEffect(() => {
    return () => {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    };
  }, []);

  const ensureRecaptcha = () => {
    if (recaptchaRef.current) return recaptchaRef.current;
    const verifier = new RecaptchaVerifier(auth, 'feituan-account-recaptcha', {
      size: 'invisible',
    });
    recaptchaRef.current = verifier;
    return verifier;
  };

  const sendCode = async () => {
    if (!phoneE164 || !phoneE164.startsWith('+')) {
      setMsg('请输入手机号；马来西亚本地号码可直接写 01…，系统会转为 +60。');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const result = await signInWithPhoneNumber(auth, phoneE164, ensureRecaptcha());
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
    const smsCode = code.replace(/\s+/g, '').trim();
    if (!smsCode) {
      setMsg('请输入验证码');
      return;
    }
    setBusy(true);
    setMsg('正在验证手机号…');
    try {
      await confirmResult.confirm(smsCode);
      navigate(returnTo, { replace: true });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '验证码校验失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="饭团账号" subtitle="手机号验证后可使用饭团钱包">
      <div className="space-y-3">
        <p className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-950">
          钱包充值、余额展示和订单抵扣都必须绑定手机号。游客仍可普通下单和上传付款截图。
        </p>
        <label className="block text-sm text-gray-800">
          手机号
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+60123456789 或 0123456789"
            className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-[16px] outline-none focus:border-orange-300"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendCode()}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? '发送中…' : '发送验证码'}
        </button>
        <div id="feituan-account-recaptcha" className="sr-only" aria-hidden />
        <label className="block text-sm text-gray-800">
          验证码
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入短信验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-[16px] outline-none focus:border-orange-300"
          />
        </label>
        <button
          type="button"
          disabled={busy || !confirmResult}
          onClick={() => void confirmCode()}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? '验证中…' : '验证并继续'}
        </button>
        {msg ? <p className="text-sm text-amber-700">{msg}</p> : null}
        <Link
          to="/feituan"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
        >
          返回饭团主页
        </Link>
      </div>
    </PageShell>
  );
}
