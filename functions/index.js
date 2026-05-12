const { onRequest } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

/** 顾客端公网域名：302/refresh 目标与相对图片补全 */
const shareAppOrigin = defineString('SHARE_APP_ORIGIN', {
  description: 'H5 站点 origin，无尾斜杠',
  default: 'https://groupbuy-app-24c46.web.app',
});

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toAbsoluteUrl(raw, baseOrigin) {
  const u = String(raw ?? '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  const base = baseOrigin.replace(/\/$/, '');
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

/**
 * 去掉 HTML / 常见 Markdown，收成一段纯文字（用于 og:description）
 */
function stripToPlainText(input) {
  if (!input || typeof input !== 'string') return '';
  let s = input;
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]*`/g, ' ');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 ');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1 ');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/_{1,2}([^_]+)_{1,2}/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

function formatDeadlineDescription(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '截止时间：待定';
  const d = ts.toDate();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `截止时间：${y}年${m}月${day}日 ${hh}:${mm}`;
}

function pickShareImage(project, shop, origin) {
  const blocks = Array.isArray(project.imageBlocks) ? project.imageBlocks : [];
  for (const b of blocks) {
    const abs = toAbsoluteUrl(b && b.url, origin);
    if (abs) return abs;
  }
  const products = Array.isArray(project.products) ? [...project.products] : [];
  products.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const p of products) {
    const abs = toAbsoluteUrl(p && p.imageUrl, origin);
    if (abs) return abs;
  }
  const banner = toAbsoluteUrl(shop && shop.bannerImage, origin);
  if (banner) return banner;
  const logo = toAbsoluteUrl(shop && shop.logoImage, origin);
  return logo || '';
}

function buildDescription(project) {
  const plain = stripToPlainText(project.textContent || '');
  if (plain.length > 0) {
    const max = 280;
    return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
  }
  return formatDeadlineDescription(project.closesAt);
}

function buildTitle(project, shop) {
  const shopName = (shop && shop.name) || '店铺';
  const title = (project && project.title) || '团购';
  return `${shopName} · ${title}`;
}

function extractProjectId(req) {
  const q = (req.query?.pid || req.query?.projectId || '').toString().trim();
  if (q) return q;
  const paths = [
    typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[0] : '',
    typeof req.url === 'string' ? req.url.split('?')[0] : '',
    req.path ? String(req.path) : '',
  ].filter(Boolean);
  for (const pathname of paths) {
    const m = pathname.match(/\/share\/([^/?]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  return '';
}

exports.shareRedirect = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 15,
  },
  async (req, res) => {
    const origin = shareAppOrigin.value().replace(/\/$/, '');
    const projectId = extractProjectId(req);

    if (!projectId) {
      res.redirect(302, origin + '/');
      return;
    }

    /** 与 web 顾客路由一致：/shop/:shopSlug/:projectId */
    let targetUrl = `${origin}/`;

    try {
      const projectRef = admin.firestore().collection('projects').doc(projectId);
      const projectSnap = await projectRef.get();
      if (!projectSnap.exists) {
        res.redirect(302, origin + '/');
        return;
      }

      const project = projectSnap.data() || {};
      const shopId = project.shopId;
      let shop = {};
      if (shopId) {
        const shopSnap = await admin.firestore().collection('shops').doc(shopId).get();
        if (shopSnap.exists) shop = shopSnap.data() || {};
      }

      const slug = (shop.slug || '').toString().trim();
      if (slug) {
        targetUrl = `${origin}/shop/${encodeURIComponent(slug)}/${encodeURIComponent(projectId)}`;
      }

      /** 与对外分享的链接一致（同域 /share/...），便于 og:url 与爬虫缓存键一致 */
      const sharePageUrl = `${origin}/share/${encodeURIComponent(projectId)}`;

      const ogTitle = buildTitle(project, shop);
      const ogDescription = buildDescription(project);
      const ogImage = pickShareImage(project, shop, origin);

      const safeTitle = escapeHtml(ogTitle);
      const safeDesc = escapeHtml(ogDescription);
      const safeImage = escapeHtml(ogImage);
      const safeCanonical = escapeHtml(sharePageUrl);
      const safeTarget = escapeHtml(targetUrl);
      /** WhatsApp/Meta 爬虫会跟随 meta refresh 抓取跳转后的 SPA，导致拿不到 og:image；真人用 JS 跳转，爬虫多数不执行脚本，留在本页读 OG。 */
      const jsTarget = JSON.stringify(targetUrl);

      const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  ${ogImage ? `<meta property="og:image" content="${safeImage}">\n  <meta property="og:image:secure_url" content="${safeImage}">` : ''}
  ${ogImage ? `<meta property="og:image:alt" content="${safeTitle}">` : ''}
  <meta property="og:url" content="${safeCanonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  ${ogImage ? `<meta name="twitter:image" content="${safeImage}">` : ''}
</head>
<body>
  <p><a href="${safeTarget}">进入团购</a></p>
  <script>window.location.replace(${jsTarget});</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.status(200).send(html);
    } catch (e) {
      console.error('shareRedirect', e);
      res.redirect(302, targetUrl);
    }
  }
);
