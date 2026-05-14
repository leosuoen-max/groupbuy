import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { PageShell } from '../components/PageShell';
import { SignOutButton } from '../components/SignOutButton';
import { useAuthUser } from '../hooks/useAuthUser';
import { getAuthClient } from '../lib/firebase';
import { getRegisteredUser } from '../lib/registeredUserService';
import { buildWechatBindStartUrl, finalizeWechatBind } from '../lib/wechatService';
import type { RegisteredUserDoc } from '../types/firestore';

type AccountCenterProps = {
  defaultReturnTo?: string;
  homeHref?: string;
  homeLabel?: string;
};

function safeReturnTo(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
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

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : phone;
}

export default function AccountCenter({
  defaultReturnTo = '/',
  homeHref = '/',
  homeLabel = '返回首页',
}: AccountCenterProps) {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const searchText = search.toString();
  const returnTo = safeReturnTo(search.get('returnTo'), defaultReturnTo);
  const bottomHref = homeHref === '/' && search.get('returnTo') ? returnTo : homeHref;
  const bottomLabel = homeHref === '/' && search.get('returnTo') ? '返回上一页' : homeLabel;
  const auth = getAuthClient();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const handledWechatBindCodeRef = useRef('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<RegisteredUserDoc | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [wechatBusy, setWechatBusy] = useState(false);
  const [wechatMsg, setWechatMsg] = useState<string | null>(null);
  const phoneE164 = useMemo(() => normalizePhone(phone), [phone]);
  const hasPhone = Boolean(user?.phoneNumber);
  const wxOpenId = profile?.wxOpenId?.trim() ?? '';
  const wechatBindCode = search.get('wechatBindCode')?.trim() ?? '';

  useEffect(() => {
    return () => {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    };
  }, []);

  const ensureRecaptcha = () => {
    if (recaptchaRef.current) return recaptchaRef.current;
    const verifier = new RecaptchaVerifier(auth, 'account-center-recaptcha', {
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

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    void getRegisteredUser(user.uid)
      .then((row) => {
        if (!cancelled) setProfile(row);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !wechatBindCode) return;
    if (handledWechatBindCodeRef.current === wechatBindCode) return;
    handledWechatBindCodeRef.current = wechatBindCode;
    let cancelled = false;
    setWechatBusy(true);
    setWechatMsg('正在绑定微信服务号…');
    void finalizeWechatBind(user, wechatBindCode)
      .then(async () => {
        if (cancelled) return;
        setWechatMsg('微信服务号已绑定，可以用于接收订单通知。');
        setProfile(await getRegisteredUser(user.uid));
        const next = new URLSearchParams(searchText);
        next.delete('wechatBindCode');
        next.set('wechat', 'bound');
        navigate(`${location.pathname}?${next.toString()}`, { replace: true });
      })
      .catch((e) => {
        if (!cancelled) {
          setWechatMsg(e instanceof Error ? e.message : '微信绑定失败');
        }
      })
      .finally(() => {
        if (!cancelled) setWechatBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate, searchText, user, wechatBindCode]);

  return (
    <PageShell title="账号中心" subtitle="游客可下单，手机号用于钱包、商户和跨设备找回">
      <div className="space-y-4">
        <section className="rounded-2xl border border-orange-100 bg-orange-50 px-3 py-3 text-xs leading-relaxed text-orange-950">
          <p className="font-semibold">身份原则</p>
          <p className="mt-1">
            不登录也可以浏览和普通下单；绑定微信后可接收订单通知；绑定手机号后可使用钱包、商户后台和跨设备账号。
          </p>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white px-3 py-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">当前账号</h2>
          {loading ? (
            <p className="text-sm text-gray-600">读取登录状态…</p>
          ) : hasPhone && user?.phoneNumber ? (
            <div className="space-y-2 text-sm text-gray-800">
              <p>
                已用手机号登录：<strong>{maskPhone(user.phoneNumber)}</strong>
              </p>
              <p className="break-all text-xs text-gray-500">UID：{user.uid}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  to={returnTo}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white"
                >
                  继续
                </Link>
                <SignOutButton
                  returnTo={homeHref}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
                >
                  退出当前账号
                </SignOutButton>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-gray-700">
              <p>当前没有手机号账号。游客订单通常只保存在当前浏览器，换设备或清缓存后可能找不回。</p>
              {user ? <p className="break-all text-xs text-gray-500">当前 UID：{user.uid}</p> : null}
            </div>
          )}
        </section>

        {!hasPhone ? (
          <section className="rounded-2xl border border-gray-100 bg-white px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">手机号登录 / 绑定</h2>
            <p className="mb-3 text-xs leading-relaxed text-gray-500">
              充值钱包、使用余额、商户注册和管理员权限都需要手机号。验证后会进入该手机号对应的正式账号。
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
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? '发送中…' : '发送验证码'}
            </button>
            <div id="account-center-recaptcha" className="sr-only" aria-hidden />
            <label className="mt-3 block text-sm text-gray-800">
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
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? '验证中…' : '验证并继续'}
            </button>
            {msg ? <p className="mt-2 text-sm text-amber-700">{msg}</p> : null}
          </section>
        ) : null}

        <section className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3 text-xs leading-relaxed text-gray-600">
          <p className="font-semibold text-gray-800">微信服务号通知</p>
          <p className="mt-1">
            微信服务号主要负责消息通知；钱包余额、商户注册和管理员权限仍以手机号账号为准。
          </p>
          {profileLoading ? (
            <p className="mt-2 text-gray-500">读取微信绑定状态…</p>
          ) : wxOpenId ? (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
              已绑定微信服务号：****{wxOpenId.slice(-6)}
            </p>
          ) : hasPhone ? (
            <a
              href={buildWechatBindStartUrl(returnTo)}
              aria-disabled={wechatBusy}
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white aria-disabled:pointer-events-none aria-disabled:opacity-60"
            >
              {wechatBusy ? '绑定中…' : '绑定微信服务号'}
            </a>
          ) : (
            <p className="mt-2 rounded-xl bg-white px-3 py-2 text-gray-600">
              请先绑定手机号，再绑定微信服务号。
            </p>
          )}
          {wechatMsg ? <p className="mt-2 text-sm text-amber-700">{wechatMsg}</p> : null}
        </section>

        <Link
          to={bottomHref}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-200 text-sm font-medium text-gray-800"
        >
          {bottomLabel}
        </Link>
      </div>
    </PageShell>
  );
}
