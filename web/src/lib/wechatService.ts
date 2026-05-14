import type { User } from 'firebase/auth';

export function buildWechatBindStartUrl(returnTo: string): string {
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/account';
  return `/wechat/oauth/start?returnTo=${encodeURIComponent(safeReturnTo)}`;
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
