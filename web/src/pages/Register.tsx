import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { PageShell } from '../components/PageShell';
import { getAuthClient } from '../lib/firebase';
import {
  consumeSignupInvite,
  getInviteGate,
} from '../lib/signupInviteService';

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
  // 默认马来西亚区号：本地手机常为 01x…（如 012、017），此处省略 + 时按 +60 解析
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return `+60${digits}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error(`${label}超过 ${Math.round(ms / 1000)} 秒无响应，请检查网络后重试`)),
      ms
    );
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

export default function Register() {
  const navigate = useNavigate();
  const params = useParams<{ token?: string }>();
  const inviteToken = params.token?.trim() || undefined;
  const [searchParams] = useSearchParams();
  const returnTo = inviteToken
    ? '/dashboard'
    : safeReturnTo(searchParams.get('returnTo'));
  const auth = getAuthClient();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<
    'idle' | 'checking' | 'ok' | 'bad'
  >(() => (inviteToken ? 'checking' : 'idle'));
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const phoneE164 = useMemo(() => normalizePhone(phone), [phone]);

  useEffect(() => {
    if (!inviteToken) {
      setInviteState('idle');
      return;
    }
    let cancelled = false;
    void (async () => {
      setInviteState('checking');
      setInviteErr(null);
      const gate = await getInviteGate(inviteToken);
      if (cancelled) return;
      if (!gate.ok) {
        setInviteState('bad');
        setInviteErr(
          gate.reason === 'used'
            ? '此邀请链接已使用过，不能再次注册。'
            : gate.reason === 'expired'
              ? '此邀请链接已过期，请联系站长重新生成。'
              : '邀请链接无效或不存在。'
        );
        return;
      }
      setInviteState('ok');
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  useEffect(() => {
    return () => {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    };
  }, []);

  const ensureRecaptcha = () => {
    if (recaptchaRef.current) return recaptchaRef.current;
    // 隐形验证：点「发送验证码」时再触发，减少微信内置浏览器卡在「人机验证」大图块上的问题
    const verifier = new RecaptchaVerifier(auth, 'register-recaptcha', {
      size: 'invisible',
    });
    recaptchaRef.current = verifier;
    return verifier;
  };

  const sendCode = async () => {
    if (!phoneE164 || !phoneE164.startsWith('+')) {
      setMsg('请输入手机号：建议用国际格式 +区号号码（如 +8613800138000、+60123456789）；马来西亚本地也可写 01…（0 开头会转为 +60）。');
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
    const smsCode = code.replace(/\s+/g, '').trim();
    if (!smsCode) {
      setMsg('请输入验证码');
      return;
    }
    setBusy(true);
    setMsg('正在校验短信验证码…');
    try {
      const credential = await withTimeout(
        confirmResult.confirm(smsCode),
        90_000,
        '短信验证'
      );
      const u = credential.user;
      if (inviteToken && u) {
        setMsg('正在完成邀请注册（写入邀请状态）…');
        try {
          await withTimeout(consumeSignupInvite(inviteToken, u.uid), 45_000, '邀请核销');
        } catch (consumeErr) {
          setMsg(
            consumeErr instanceof Error
              ? `${consumeErr.message}（你已登录，可联系站长处理邀请状态）`
              : '邀请核销失败'
          );
          return;
        }
      }
      setMsg(null);
      const dest = returnTo || '/dashboard';
      navigate(dest, { replace: true });
      // 部分移动浏览器上 SPA 跳转偶发不生效，短延迟后整页跳转让用户必达
      window.setTimeout(() => {
        const p = window.location.pathname;
        if (p.includes('/invite-register/') || p === '/register' || p.startsWith('/register')) {
          window.location.assign(dest);
        }
      }, 2000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '验证码校验失败');
    } finally {
      setBusy(false);
    }
  };

  if (inviteToken && inviteState === 'checking') {
    return (
      <PageShell title="邀请注册" subtitle="校验链接…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (inviteToken && inviteState === 'bad') {
    return (
      <PageShell title="邀请注册" subtitle="无法使用">
        <p className="text-sm text-gray-800">{inviteErr ?? '链接无效。'}</p>
        <Link
          to="/"
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
        >
          返回首页
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={inviteToken ? '邀请注册' : '注册'}
      subtitle={
        inviteToken
          ? '站长邀请链接，验证手机号后仅可使用一次'
          : '手机号验证码'
      }
    >
      <div className="space-y-3">
        <label className="block text-sm text-gray-800">
          手机号
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="例如 +8613800138000 或 +60123456789"
            className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-indigo-300"
          />
        </label>
        <p className="text-[11px] leading-relaxed text-gray-500">
          <strong>012</strong> 等指<strong>马来西亚本地手机常见前缀</strong>（<code className="rounded bg-gray-100 px-0.5">01x…</code>
          ，不同运营商为 010/011/012/013/014/016/017/018/019 等）。不写 <code className="rounded bg-gray-100 px-0.5">+</code> 且以{' '}
          <code className="rounded bg-gray-100 px-0.5">0</code> 开头时，本页会<strong>按马来西亚 +60</strong>自动补区号。
        </p>
        <p className="text-[11px] leading-relaxed text-gray-500">
          <strong>其他国家/地区</strong>：请写完整<strong>国际 E.164</strong>（<code className="rounded bg-gray-100 px-0.5">+</code>
          国家码 + 号码，中间可空格）。能否收到短信以 <strong>Firebase 手机验证</strong> 对该号码的支持为准，全球多数国家/地区可用，少数号段或风控下可能失败。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendCode()}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? '发送中…' : '发送验证码'}
        </button>
        <p className="text-[11px] leading-relaxed text-gray-500">
          点「发送验证码」后会做人机校验。若发码卡住，可换网络或换系统浏览器重试。
        </p>

        <div id="register-recaptcha" className="sr-only" aria-hidden />

        <label className="block text-sm text-gray-800">
          验证码
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入短信验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-indigo-300"
          />
        </label>
        <button
          type="button"
          disabled={busy || !confirmResult}
          onClick={() => void confirmCode()}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? inviteToken
              ? '处理中…'
              : '验证中…'
            : inviteToken
              ? '确认注册'
              : '确认注册并进入后台'}
        </button>

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
