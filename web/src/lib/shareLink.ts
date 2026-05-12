/**
 * WhatsApp 等链接预览依赖爬虫读取 HTML 里的 og:*（Meta 抓取栈）。
 * SPA 直链 `/shop/:slug/:projectId` 首包无动态 meta，复制分享须用 `/share/:projectId`
 *（Hosting 重写到 Cloud Function `shareRedirect`）。
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
