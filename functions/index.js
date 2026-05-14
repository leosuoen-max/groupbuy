/**
 * WhatsApp 链接预览（Open Graph）：仅处理 GET /share/:projectId（Hosting 重写）。
 * 不尝试清洗商户编辑标记或与标题去重（易 brittle，已放弃）；摘要为 textContent 转纯文本。
 * 真人浏览器用 JS 跳转团购页；勿用 meta refresh，以免爬虫跟丢 og:image。
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

function getShareAppOrigin() {
  const env = process.env.SHARE_APP_ORIGIN;
  const raw =
    typeof env === 'string' && env.trim()
      ? env.trim()
      : 'https://groupbuy-app-24c46.web.app';
  return raw.replace(/\/+$/, '');
}

function getAppOrigin() {
  return getShareAppOrigin();
}

function getWechatConfig() {
  return {
    appId: (process.env.WECHAT_APP_ID || '').trim(),
    appSecret: (process.env.WECHAT_APP_SECRET || '').trim(),
    token: (process.env.WECHAT_TOKEN || '').trim(),
  };
}

function safeReturnTo(raw, fallback = '/account') {
  const v = String(raw || '').trim();
  if (!v || !v.startsWith('/') || v.startsWith('//')) return fallback;
  return v;
}

function verifyWechatSignature(query, token) {
  const signature = String(query.signature || '').trim();
  const timestamp = String(query.timestamp || '').trim();
  const nonce = String(query.nonce || '').trim();
  if (!signature || !timestamp || !nonce || !token) return false;
  const expected = crypto
    .createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function makeState() {
  return crypto.randomBytes(18).toString('base64url');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** og:image URL 属性内保留字面 &，勿写成 &amp;，否则部分爬虫请求 Storage 失败 */
function escapeHtmlAttrUrl(url) {
  return String(url ?? '').replace(/"/g, '&quot;');
}

function toAbsoluteUrl(raw, baseOrigin) {
  const u = String(raw ?? '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  const base = baseOrigin.replace(/\/$/, '');
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

/** 说明区 → OG 摘要（轻量字符串处理，不做额外网络请求） */
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

      const sharePageUrl = `${origin}/share/${encodeURIComponent(projectId)}`;

      const ogTitle = buildTitle(project, shop);
      const ogDescription = buildDescription(project);
      const ogImage = pickShareImage(project, shop, origin);

      const safeTitle = escapeHtml(ogTitle);
      const safeDesc = escapeHtml(ogDescription);
      const safeImageUrl = ogImage ? escapeHtmlAttrUrl(ogImage) : '';
      const safeCanonical = escapeHtml(sharePageUrl);
      const safeTarget = escapeHtml(targetUrl);
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
  ${ogImage ? `<meta property="og:image" content="${safeImageUrl}">\n  <meta property="og:image:secure_url" content="${safeImageUrl}">\n  <meta property="og:image:alt" content="${safeTitle}">` : ''}
  <meta property="og:url" content="${safeCanonical}">
</head>
<body>
  <p><a href="${safeTarget}">进入团购</a></p>
  <script>window.location.replace(${jsTarget});</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.status(200).send(html);
    } catch (e) {
      console.error('shareRedirect', e);
      res.redirect(302, targetUrl);
    }
  }
);

exports.wechatWebhook = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 15,
  },
  async (req, res) => {
    const { token } = getWechatConfig();
    if (!token) {
      res.status(500).send('WECHAT_TOKEN is not configured');
      return;
    }

    if (!verifyWechatSignature(req.query || {}, token)) {
      res.status(403).send('invalid signature');
      return;
    }

    if (req.method === 'GET') {
      res.status(200).send(String(req.query.echostr || ''));
      return;
    }

    // 第一版先完成服务号接入校验；后续收到关注/取关等事件时再解析 XML 入队。
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send('success');
  }
);

exports.wechatOAuthStart = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 15,
  },
  async (req, res) => {
    const { appId } = getWechatConfig();
    if (!appId) {
      res.status(500).send('WECHAT_APP_ID is not configured');
      return;
    }

    const origin = getAppOrigin();
    const state = makeState();
    const returnTo = safeReturnTo(req.query.returnTo, '/account');
    const scope = String(req.query.scope || 'snsapi_base').trim() === 'snsapi_userinfo'
      ? 'snsapi_userinfo'
      : 'snsapi_base';

    await admin.firestore().collection('wechat_oauth_states').doc(state).set({
      state,
      returnTo,
      scope,
      status: 'started',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const redirectUri = `${origin}/wechat/oauth/callback`;
    const url =
      'https://open.weixin.qq.com/connect/oauth2/authorize?' +
      new URLSearchParams({
        appid: appId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        state,
      }).toString() +
      '#wechat_redirect';

    res.redirect(302, url);
  }
);

exports.wechatOAuthCallback = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (req, res) => {
    const { appId, appSecret } = getWechatConfig();
    const origin = getAppOrigin();
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    const fallback = `${origin}/account?wechat=failed`;

    if (!appId || !appSecret) {
      res.redirect(302, `${fallback}&reason=config`);
      return;
    }
    if (!code || !state) {
      res.redirect(302, `${fallback}&reason=missing_code`);
      return;
    }

    const db = admin.firestore();
    const stateRef = db.collection('wechat_oauth_states').doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      res.redirect(302, `${fallback}&reason=invalid_state`);
      return;
    }
    const stateData = stateSnap.data() || {};
    const returnTo = safeReturnTo(stateData.returnTo, '/account');

    try {
      const tokenUrl =
        'https://api.weixin.qq.com/sns/oauth2/access_token?' +
        new URLSearchParams({
          appid: appId,
          secret: appSecret,
          code,
          grant_type: 'authorization_code',
        }).toString();
      const tokenResp = await fetch(tokenUrl);
      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok || tokenJson.errcode || !tokenJson.openid) {
        console.error('wechatOAuthCallback token error', tokenJson);
        await stateRef.set(
          {
            status: 'failed',
            error: tokenJson,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        res.redirect(302, `${origin}/account?wechat=failed&reason=wechat&returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }

      await stateRef.set(
        {
          status: 'authorized',
          openid: tokenJson.openid,
          unionid: tokenJson.unionid || null,
          scope: tokenJson.scope || stateData.scope || null,
          authorizedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      res.redirect(
        302,
        `${origin}/account?wechat=authorized&wechatBindCode=${encodeURIComponent(state)}&returnTo=${encodeURIComponent(returnTo)}`
      );
    } catch (e) {
      console.error('wechatOAuthCallback', e);
      await stateRef.set(
        {
          status: 'failed',
          error: String((e && e.message) || e),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.redirect(302, `${origin}/account?wechat=failed&reason=exception&returnTo=${encodeURIComponent(returnTo)}`);
    }
  }
);

exports.wechatBindFinalize = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, message: 'method not allowed' });
      return;
    }

    const authHeader = String(req.headers.authorization || '');
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      res.status(401).json({ ok: false, message: 'missing auth token' });
      return;
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(m[1]);
    } catch {
      res.status(401).json({ ok: false, message: 'invalid auth token' });
      return;
    }

    const bindCode = String((req.body && req.body.bindCode) || '').trim();
    if (!bindCode) {
      res.status(400).json({ ok: false, message: 'missing bindCode' });
      return;
    }

    const db = admin.firestore();
    const stateRef = db.collection('wechat_oauth_states').doc(bindCode);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      res.status(404).json({ ok: false, message: 'binding session not found' });
      return;
    }
    const stateData = stateSnap.data() || {};
    if (stateData.status !== 'authorized' || !stateData.openid) {
      res.status(400).json({ ok: false, message: 'binding session is not ready' });
      return;
    }

    const uid = decoded.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const userRef = db.collection('registered_users').doc(uid);
    const openidRef = db.collection('wechat_openids').doc(stateData.openid);

    await db.runTransaction(async (tx) => {
      tx.set(
        userRef,
        {
          uid,
          wxOpenId: stateData.openid,
          wxUnionId: stateData.unionid || null,
          wxBoundAt: now,
          lastSeenAt: now,
        },
        { merge: true }
      );
      tx.set(
        openidRef,
        {
          openid: stateData.openid,
          unionid: stateData.unionid || null,
          uid,
          updatedAt: now,
        },
        { merge: true }
      );
      tx.set(
        stateRef,
        {
          status: 'bound',
          boundUid: uid,
          boundAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    res.status(200).json({ ok: true, openidMasked: `****${String(stateData.openid).slice(-6)}` });
  }
);
