import type { User } from 'firebase/auth';

const WECHAT_NOTIFY_STATE_KEY = 'dmft_wechat_notify_oauth_state_v1';
const WECHAT_OAUTH_PENDING_KEY = 'dmft_wechat_oauth_pending_return_v1';

export function buildWechatBindStartUrl(returnTo: string): string {
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/account';
  return `/wechat/oauth/start?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function isWechatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent || '');
}

function safeReturnTo(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function getWechatNotifyOAuthStateId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const stateId = localStorage.getItem(WECHAT_NOTIFY_STATE_KEY)?.trim();
  return stateId || null;
}

export function consumeWechatNotifyOAuthStateFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.searchParams.get('wechat') === 'session_failed') {
    url.searchParams.delete('wechat');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return getWechatNotifyOAuthStateId();
  }
  const stateId = url.searchParams.get('wechatSessionId')?.trim() ?? '';
  if (!stateId) return getWechatNotifyOAuthStateId();

  localStorage.setItem(WECHAT_NOTIFY_STATE_KEY, stateId);
  sessionStorage.removeItem(WECHAT_OAUTH_PENDING_KEY);
  url.searchParams.delete('wechatSessionId');
  if (url.searchParams.get('wechat') === 'session') {
    url.searchParams.delete('wechat');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  return stateId;
}

export function ensureWechatNotifyOAuthState(): string | null {
  if (typeof window === 'undefined') return null;
  const existing = consumeWechatNotifyOAuthStateFromUrl();
  if (existing) return existing;
  if (!isWechatBrowser()) return null;
  if (window.location.pathname.startsWith('/wechat/')) return null;

  const returnTo = safeReturnTo(
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
  const pending = sessionStorage.getItem(WECHAT_OAUTH_PENDING_KEY);
  if (pending === returnTo) return null;
  sessionStorage.setItem(WECHAT_OAUTH_PENDING_KEY, returnTo);
  window.location.replace(
    `/wechat/oauth/start?mode=session&returnTo=${encodeURIComponent(returnTo)}`
  );
  return null;
}

export async function finalizeWechatBind(user: User, bindCode: string): Promise<void> {
  const code = bindCode.trim();
  if (!code) throw new Error('缺少微信绑定码');
  const token = await user.getIdToken();
  const resp = await fetch('/api/wechat/bind', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bindCode: code }),
  });
  const data = (await resp.json().catch(() => null)) as { message?: string } | null;
  if (!resp.ok) {
    throw new Error(data?.message || '微信绑定失败');
  }
}
