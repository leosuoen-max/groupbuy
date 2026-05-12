const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const sizeOf = require('image-size');

if (!admin.apps.length) {
  admin.initializeApp();
}

/** 顾客端公网 origin（无尾斜杠）。可用 Cloud 环境变量 SHARE_APP_ORIGIN 覆盖，避免 deploy 时交互询问 Params。 */
function getShareAppOrigin() {
  const env = process.env.SHARE_APP_ORIGIN;
  const raw =
    typeof env === 'string' && env.trim()
      ? env.trim()
      : 'https://groupbuy-app-24c46.web.app';
  return raw.replace(/\/+$/, '');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * og:image 等属性里的 URL：勿把 `&` 写成 `&amp;`。部分链接预览爬虫会把属性值原样当 URL，
 * 请求 `...?alt=media&amp;token=...` 会导致 Firebase 下载失败，WhatsApp 只有标题无缩略图。
 */
function escapeHtmlAttrUrl(url) {
  return String(url ?? '').replace(/"/g, '&quot;');
}

async function probeImageDimensions(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await fetch(imageUrl, {
      headers: {
        Range: 'bytes=0-524287',
        'User-Agent': 'facebookexternalhit/1.1',
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dim = sizeOf(buf);
    if (!dim.width || !dim.height) return null;
    return { width: dim.width, height: dim.height };
  } catch (e) {
    console.warn('probeImageDimensions', e?.message || e);
    return null;
  }
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

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 与 web/src/lib/descriptionRichText.ts 同源：配对嵌套的〔小〕/〔大〕 */
function findBalancedWrapperEnd(s, start, open, close) {
  if (!s.startsWith(open, start)) return null;
  let depth = 1;
  let i = start + open.length;
  while (i < s.length && depth > 0) {
    if (s.startsWith(open, i)) {
      depth += 1;
      i += open.length;
    } else if (s.startsWith(close, i)) {
      depth -= 1;
      if (depth === 0) {
        return {
          inner: s.slice(start + open.length, i),
          endExclusive: i + close.length,
        };
      }
      i += close.length;
    } else {
      i += 1;
    }
  }
  return null;
}

/** 尾标签里的斜杠可能是半角 / 或全角 ／（Unicode FF0F） */
function normalizeMarkerSlashes(input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/〔／小〕/g, '〔/小〕').replace(/〔／大〕/g, '〔/大〕');
}

/**
 * 去掉「稍大/稍小」包装，只保留内层正文（与顾客端渲染语义一致，OG 不留〔小〕等符号）。
 */
function unwrapRichMarkers(input) {
  const pairs = [
    ['〔小〕', '〔/小〕'],
    ['〔大〕', '〔/大〕'],
  ];
  function walk(s) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      let consumed = false;
      for (const [open, close] of pairs) {
        if (s.startsWith(open, i)) {
          const m = findBalancedWrapperEnd(s, i, open, close);
          if (m) {
            out += walk(m.inner);
            i = m.endExclusive;
            consumed = true;
            break;
          }
        }
      }
      if (!consumed) {
        out += s[i];
        i += 1;
      }
    }
    return out;
  }
  return walk(normalizeMarkerSlashes(input));
}

/** 兜底：零散的【】类符号（非平衡片段） */
function stripStrayBracketMarkers(input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/【小】|【\/小】|【／小】|【大】|【\/大】|【／大】|〔小〕|〔\/小〕|〔大〕|〔\/大〕/g, '');
}

function normalizePlainWhitespace(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 与顾客端 stripLeadingDuplicateProjectTitle 一致；NFKC 避免全角空格等导致去重失败 */
function stripLeadingDuplicateProjectTitlePlain(plain, projectTitle) {
  let s = normalizePlainWhitespace(plain);
  const p = normalizePlainWhitespace(projectTitle || '');
  if (!p) return s;
  const re = new RegExp(`^${escapeRegExp(p)}(?:\\s*[！!。.…]*)?\\s*`);
  for (let i = 0; i < 5; i++) {
    const next = s.replace(re, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function stripHeadingMarkersLine(plain) {
  return String(plain)
    .replace(/^【标题】\s*/gm, '')
    .trim();
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
  let raw = project.textContent || '';
  raw = normalizeMarkerSlashes(raw);
  raw = unwrapRichMarkers(raw);
  raw = stripStrayBracketMarkers(raw);
  let plain = stripToPlainText(raw);
  plain = stripHeadingMarkersLine(plain);
  plain = stripLeadingDuplicateProjectTitlePlain(plain, (project && project.title) || '');
  plain = normalizePlainWhitespace(plain);
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
    const origin = getShareAppOrigin();
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
      const imgDims = ogImage ? await probeImageDimensions(ogImage) : null;

      const safeTitle = escapeHtml(ogTitle);
      const safeDesc = escapeHtml(ogDescription);
      const safeImageUrl = ogImage ? escapeHtmlAttrUrl(ogImage) : '';
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
  ${ogImage ? `<meta property="og:image" content="${safeImageUrl}">\n  <meta property="og:image:secure_url" content="${safeImageUrl}">` : ''}
  ${imgDims ? `<meta property="og:image:width" content="${imgDims.width}">\n  <meta property="og:image:height" content="${imgDims.height}">` : ''}
  ${ogImage ? `<meta property="og:image:alt" content="${safeTitle}">` : ''}
  <meta property="og:url" content="${safeCanonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  ${ogImage ? `<meta name="twitter:image" content="${safeImageUrl}">` : ''}
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
