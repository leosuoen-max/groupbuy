/**
 * 聊天链接预览（WhatsApp / 微信等）依赖爬虫读取 HTML 里的 og:* meta。
 * SPA 路由 `/shop/:slug/:projectId` 的首包仍是通用 index.html，没有动态 meta，
 * 因此对外分享须使用 `/share/:projectId`（Hosting 重写到 Cloud Function `shareRedirect`）。
 */

export function resolvePublicOrigin(): string {
  const envOrigin = (import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined)?.trim();
  if (envOrigin) return envOrigin.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

/** 给用户复制、系统分享用的 URL（带 OG 落地页） */
export function getProjectSharePageUrl(projectId: string): string {
  const origin = resolvePublicOrigin();
  const path = `/share/${encodeURIComponent(projectId)}`;
  return origin ? `${origin}${path}` : path;
}
