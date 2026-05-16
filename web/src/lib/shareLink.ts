/**
 * WhatsApp / 外链预览爬虫读 HTML 里的 `og:*`（一般不执行 SPA JS）。
 * 直链 SPA（`/shop/...`、`/feituan`）首包常为壳子 + module 脚本，预览易打成「代码串」。
 * 复制分享应用带 OG 的落地页：
 * - 团购项目：`/share/:projectId` → Hosting 重写至 `shareRedirect`
 * - 饭团首页：`/share/feituan`（`shareRedirect` 内按保留字分支，非 Firestore 文档 id）
 */

/**
 * 外链预览缓存刷新：调整摘要/图后请递增，并与 `functions/index.js` 顶部的
 * `FEITUAN_HOME_SHARE_QUERY` 保持同步。
 */
export const FEITUAN_HOME_SHARE_QUERY = 'cv=4';

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

/** 饭团首页外链 / 复制用（同上 Cloud Function OG 落地页）。实际 App 仍为 `/feituan`。 */
export function getFeituanHomeShareUrl(): string {
  const origin = resolvePublicOrigin();
  const qs = FEITUAN_HOME_SHARE_QUERY.trim();
  const path = `/share/feituan${qs ? `?${qs}` : ''}`;
  return origin ? `${origin}${path}` : path;
}
