/**
 * WhatsApp 链接预览（Open Graph）：处理 GET /share/:path（Hosting 重写）。
 * - `/share/:projectId`：读 projects 文档，返回项目 OG + 跳转 shop 或饭团项目页。
 * - `/share/feituan`：保留字，非 Firestore 文档 id；聚合「饭团上架中」项目生成首页 OG，跳转 `/feituan`。
 * 真人浏览器用 JS 跳转真实页；勿用 meta refresh，以免爬虫跟丢 og:image。
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

/** 与 web/src/lib/shareLink.ts FEITUAN_HOME_SHARE_QUERY 同步；调整文案/预览后递增以刷新抓取缓存 */
const FEITUAN_HOME_SHARE_QUERY = 'cv=4';

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
    orderSubmittedTemplateId: (process.env.WECHAT_ORDER_SUBMITTED_TEMPLATE_ID || '').trim(),
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

function appendQuery(path, params) {
  const url = new URL(String(path || '/'), 'https://local.invalid');
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function formatMoney(n) {
  return `RM ${(Number(n) || 0).toFixed(2)}`;
}

async function getWechatAccessToken() {
  const { appId, appSecret } = getWechatConfig();
  if (!appId || !appSecret) {
    throw new Error('WECHAT_APP_ID or WECHAT_APP_SECRET is not configured');
  }

  const db = admin.firestore();
  const ref = db.collection('wechat_runtime').doc('access_token');
  const snap = await ref.get();
  const cached = snap.exists ? snap.data() || {} : {};
  if (
    cached.accessToken &&
    Number(cached.expiresAtMillis || 0) > Date.now() + 60_000
  ) {
    return cached.accessToken;
  }

  const url =
    'https://api.weixin.qq.com/cgi-bin/token?' +
    new URLSearchParams({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
    }).toString();
  const resp = await fetch(url);
  const json = await resp.json();
  if (!resp.ok || json.errcode || !json.access_token) {
    throw new Error(`wechat access_token failed: ${JSON.stringify(json)}`);
  }
  const expiresInSec = Number(json.expires_in || 7200);
  const expiresAtMillis = Date.now() + Math.max(60, expiresInSec - 300) * 1000;
  await ref.set(
    {
      accessToken: json.access_token,
      expiresAtMillis,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return json.access_token;
}

async function getWechatJsapiTicket() {
  const db = admin.firestore();
  const ref = db.collection('wechat_runtime').doc('jsapi_ticket');
  const snap = await ref.get();
  const cached = snap.exists ? snap.data() || {} : {};
  if (
    cached.ticket &&
    Number(cached.expiresAtMillis || 0) > Date.now() + 60_000
  ) {
    return cached.ticket;
  }

  const token = await getWechatAccessToken();
  const url =
    'https://api.weixin.qq.com/cgi-bin/ticket/getticket?' +
    new URLSearchParams({
      access_token: token,
      type: 'jsapi',
    }).toString();
  const resp = await fetch(url);
  const json = await resp.json();
  if (!resp.ok || json.errcode || !json.ticket) {
    throw new Error(`wechat jsapi_ticket failed: ${JSON.stringify(json)}`);
  }
  const expiresInSec = Number(json.expires_in || 7200);
  const expiresAtMillis = Date.now() + Math.max(60, expiresInSec - 300) * 1000;
  await ref.set(
    {
      ticket: json.ticket,
      expiresAtMillis,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return json.ticket;
}

function normalizeWechatJsSdkUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  parsed.hash = '';
  return parsed.toString();
}

function isAllowedWechatJsSdkUrl(url) {
  const origin = getAppOrigin();
  try {
    const target = new URL(url);
    const app = new URL(origin);
    return target.host === app.host && target.protocol === app.protocol;
  } catch {
    return false;
  }
}

function makeWechatJsSdkSignature(ticket, url) {
  const nonceStr = crypto.randomBytes(12).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const plain = [
    `jsapi_ticket=${ticket}`,
    `noncestr=${nonceStr}`,
    `timestamp=${timestamp}`,
    `url=${url}`,
  ].join('&');
  const signature = crypto.createHash('sha1').update(plain).digest('hex');
  return { nonceStr, timestamp, signature };
}

async function sendWechatTemplateMessage(payload) {
  const token = await getWechatAccessToken();
  const resp = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const json = await resp.json();
  if (!resp.ok || json.errcode) {
    throw new Error(`wechat template send failed: ${JSON.stringify(json)}`);
  }
  return json;
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

function compactPlainText(input, max) {
  const plain = stripToPlainText(typeof input === 'string' ? input : '');
  if (!plain) return '';
  const n = Number(max) || 80;
  return plain.length <= n ? plain : `${plain.slice(0, n - 1)}…`;
}

/** 微信摘要解析对 emoji 等字符较敏感，外链预览描述尽量用纯文本 */
function stripEmojiForOg(input) {
  return String(input ?? '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
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

/** 与前端 buildFeituanHomeShareCard 一致：商品图 → 说明图 → 店铺图，最后回退 Logo */
function pickFeituanHomeShareImage(project, shop, origin) {
  const products = Array.isArray(project.products) ? [...project.products] : [];
  products.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const p of products) {
    const abs = toAbsoluteUrl(p && p.imageUrl, origin);
    if (abs) return abs;
  }
  const blocks = Array.isArray(project.imageBlocks) ? project.imageBlocks : [];
  for (const b of blocks) {
    if (String(b?.url ?? '').trim()) {
      const abs = toAbsoluteUrl(b.url, origin);
      if (abs) return abs;
    }
  }
  const banner = toAbsoluteUrl(shop && shop.bannerImage, origin);
  if (banner) return banner;
  return toAbsoluteUrl(shop && shop.logoImage, origin);
}

function kualaLumpurMonthDay() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date());
    const m = Number(parts.find((p) => p.type === 'month')?.value ?? 1);
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? 1);
    return { m, day };
  } catch {
    const d = new Date();
    return { m: d.getMonth() + 1, day: d.getDate() };
  }
}

function sendOgSharePage(res, { sharePageUrl, targetUrl, ogTitle, ogDescription, ogImage, bodyLinkText }) {
  const safeTitle = escapeHtml(ogTitle);
  const safeDesc = escapeHtml(stripEmojiForOg(ogDescription));
  const safeImageUrl = ogImage ? escapeHtmlAttrUrl(ogImage) : '';
  const safeCanonical = escapeHtml(sharePageUrl);
  const safeTarget = escapeHtml(targetUrl);
  const jsTarget = JSON.stringify(targetUrl);
  const linkLabel =
    typeof bodyLinkText === 'string' && bodyLinkText.trim() ? bodyLinkText.trim() : '进入团购';
  const ogImageTags = ogImage
    ? `<meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:secure_url" content="${safeImageUrl}">
  <meta property="og:image:alt" content="${safeTitle}">`
    : '';

  const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="大马饭团">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  ${ogImageTags}
  <meta property="og:url" content="${safeCanonical}">
</head>
<body>
  <p><a href="${safeTarget}">${escapeHtml(linkLabel)}</a></p>
  <script>window.location.replace(${jsTarget});</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.status(200).send(html);
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
    const projectIdRaw = extractProjectId(req);

    if (!projectIdRaw) {
      res.redirect(302, origin + '/');
      return;
    }
    let fallbackTargetUrl = `${origin}/`;

    try {
      /** 饭团首页：外链须 `/share/feituan`，与前端 getFeituanHomeShareUrl 一致 */
      if (projectIdRaw.toLowerCase() === 'feituan') {
        const shareQs = FEITUAN_HOME_SHARE_QUERY ? `?${FEITUAN_HOME_SHARE_QUERY}` : '';
        const sharePageUrl = `${origin}/share/feituan${shareQs}`;
        const targetUrl = `${origin}/feituan`;
        fallbackTargetUrl = targetUrl;

        const { m: klMonth, day: klDay } = kualaLumpurMonthDay();
        const sameOriginLogo = `${origin.replace(/\/$/, '')}/feituan-logo.png`;
        let ogTitle = `大马饭团｜${klMonth}月${klDay}日｜今日团`;
        let ogDescription =
          '今日精选饭团，和朋友一起拼单下单。';
        let ogImage = sameOriginLogo;

        try {
          const listedSnap = await admin
            .firestore()
            .collection('projects')
            .where('feituanStatus', '==', 'listed')
            .get();

          const now = Date.now();
          const sorted = listedSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() || {}) }))
            .filter((p) => {
              const ca = p.closesAt;
              if (!ca || typeof ca.toDate !== 'function') return true;
              return ca.toDate().getTime() > now;
            })
            .sort((a, b) => {
              const ta = a.feituanReviewedAt?.toMillis?.() ?? 0;
              const tb = b.feituanReviewedAt?.toMillis?.() ?? 0;
              return tb - ta;
            });

          if (sorted.length > 0) {
            const shopIds = [...new Set(sorted.map((p) => p.shopId).filter(Boolean))];
            const shopReads = shopIds.map((sid) =>
              admin.firestore().collection('shops').doc(String(sid)).get()
            );
            const shopSnaps = await Promise.all(shopReads);
            const shopById = new Map(
              shopSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() || {}])
            );

            const items = sorted.map((p) => ({
              project: p,
              shop: p.shopId ? shopById.get(String(p.shopId)) || {} : {},
            }));

            const shopNames = [
              ...new Set(
                items.map((it) => (it.shop && String(it.shop.name || '').trim()) || '').filter(
                  Boolean
                )
              ),
            ];

            const descByShops = shopNames.join('、');
            const first = items[0];
            const firstIntro = first
              ? compactPlainText(String(first.project.textContent || ''), 42)
              : '';
            ogDescription =
              descByShops.length >= 12
                ? descByShops
                : ([descByShops, firstIntro].filter(Boolean).join('｜') || ogDescription);

            ogImage =
              pickFeituanHomeShareImage(first.project, first.shop || {}, origin) || sameOriginLogo;
          }
        } catch (e) {
          console.error('shareRedirect feituan aggregate', e);
        }

        sendOgSharePage(res, {
          sharePageUrl,
          targetUrl,
          ogTitle,
          ogDescription,
          ogImage,
          bodyLinkText: '进入饭团',
        });
        return;
      }

      const projectRef = admin.firestore().collection('projects').doc(projectIdRaw);
      const projectSnap = await projectRef.get();
      if (!projectSnap.exists) {
        res.redirect(302, origin + '/');
        return;
      }

      const project = projectSnap.data() || {};
      const shopDocId = project.shopId ? String(project.shopId) : '';
      let shop = {};
      if (shopDocId) {
        const shopSnap = await admin.firestore().collection('shops').doc(shopDocId).get();
        if (shopSnap.exists) shop = shopSnap.data() || {};
      }

      const slug = (shop.slug || '').toString().trim();
      let targetUrl = `${origin}/`;
      if (project.feituanStatus === 'listed') {
        targetUrl = `${origin}/feituan/projects/${encodeURIComponent(projectIdRaw)}`;
      } else if (slug) {
        targetUrl = `${origin}/shop/${encodeURIComponent(slug)}/${encodeURIComponent(projectIdRaw)}`;
      }
      fallbackTargetUrl = targetUrl;

      const sharePageUrl = `${origin}/share/${encodeURIComponent(projectIdRaw)}`;

      const ogTitle = buildTitle(project, shop);
      const ogDescription = buildDescription(project);
      const ogImage = pickShareImage(project, shop, origin);

      sendOgSharePage(res, {
        sharePageUrl,
        targetUrl,
        ogTitle,
        ogDescription,
        ogImage,
      });
    } catch (e) {
      console.error('shareRedirect', e);
      res.redirect(302, fallbackTargetUrl);
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
    const mode = String(req.query.mode || '').trim() === 'session' ? 'session' : 'account_bind';
    const scope = String(req.query.scope || 'snsapi_base').trim() === 'snsapi_userinfo'
      ? 'snsapi_userinfo'
      : 'snsapi_base';

    await admin.firestore().collection('wechat_oauth_states').doc(state).set({
      state,
      returnTo,
      mode,
      scope,
      status: 'started',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
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
    const isSessionMode = stateData.mode === 'session';

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
        res.redirect(
          302,
          isSessionMode
            ? `${origin}${appendQuery(returnTo, { wechat: 'session_failed' })}`
            : `${origin}/account?wechat=failed&reason=wechat&returnTo=${encodeURIComponent(returnTo)}`
        );
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

      if (isSessionMode) {
        res.redirect(
          302,
          `${origin}${appendQuery(returnTo, {
            wechat: 'session',
            wechatSessionId: state,
          })}`
        );
        return;
      }

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
      res.redirect(
        302,
        isSessionMode
          ? `${origin}${appendQuery(returnTo, { wechat: 'session_failed' })}`
          : `${origin}/account?wechat=failed&reason=exception&returnTo=${encodeURIComponent(returnTo)}`
      );
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

exports.wechatJsSdkSignature = onRequest(
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

    const { appId } = getWechatConfig();
    if (!appId) {
      res.status(500).json({ ok: false, message: 'WECHAT_APP_ID is not configured' });
      return;
    }

    const url = normalizeWechatJsSdkUrl(req.body && req.body.url);
    if (!url) {
      res.status(400).json({ ok: false, message: 'missing url' });
      return;
    }
    if (!isAllowedWechatJsSdkUrl(url)) {
      res.status(403).json({ ok: false, message: 'url origin is not allowed' });
      return;
    }

    try {
      const ticket = await getWechatJsapiTicket();
      const sign = makeWechatJsSdkSignature(ticket, url);
      res.status(200).json({
        ok: true,
        appId,
        nonceStr: sign.nonceStr,
        timestamp: sign.timestamp,
        signature: sign.signature,
      });
    } catch (e) {
      console.error('wechatJsSdkSignature', e);
      res.status(500).json({
        ok: false,
        message: String((e && e.message) || e),
      });
    }
  }
);

exports.wechatOrderSubmittedNotify = onRequest(
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

    const orderId = String((req.body && req.body.orderId) || '').trim();
    const customerKey = String((req.body && req.body.customerKey) || '').trim();
    if (!orderId || !customerKey) {
      res.status(400).json({ ok: false, message: 'missing orderId or customerKey' });
      return;
    }

    const db = admin.firestore();
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      res.status(404).json({ ok: false, message: 'order not found' });
      return;
    }
    const order = orderSnap.data() || {};
    if (order.customerKey !== customerKey) {
      res.status(403).json({ ok: false, message: 'not your order' });
      return;
    }
    if (order.channel !== 'feituan') {
      res.status(200).json({ ok: true, skipped: true, reason: 'not_feituan_order' });
      return;
    }
    if (order.wechatOrderSubmittedNotification?.status === 'sent') {
      res.status(200).json({ ok: true, skipped: true, reason: 'already_sent' });
      return;
    }

    const { orderSubmittedTemplateId } = getWechatConfig();
    if (!orderSubmittedTemplateId) {
      await orderRef.set(
        {
          wechatOrderSubmittedNotification: {
            status: 'skipped',
            reason: 'missing_template_id',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, skipped: true, reason: 'missing_template_id' });
      return;
    }

    const stateId = String(order.wechatNotifyOAuthStateId || '').trim();
    if (!stateId) {
      await orderRef.set(
        {
          wechatOrderSubmittedNotification: {
            status: 'skipped',
            reason: 'missing_wechat_session',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, skipped: true, reason: 'missing_wechat_session' });
      return;
    }

    const stateSnap = await db.collection('wechat_oauth_states').doc(stateId).get();
    const state = stateSnap.exists ? stateSnap.data() || {} : {};
    const openid = String(state.openid || '').trim();
    if (!openid || state.status !== 'authorized') {
      await orderRef.set(
        {
          wechatOrderSubmittedNotification: {
            status: 'skipped',
            reason: 'wechat_session_not_authorized',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, skipped: true, reason: 'wechat_session_not_authorized' });
      return;
    }

    const origin = getAppOrigin();
    const orderUrl = `${origin}/feituan/projects/${encodeURIComponent(order.projectId || '')}/orders/${encodeURIComponent(order.orderNumber || '')}`;
    const projectTitle = order.projectTitle || '大马饭团订单';
    const displayOrderNo = `${projectTitle} #${order.orderNumber || orderId}`;
    const payload = {
      touser: openid,
      template_id: orderSubmittedTemplateId,
      url: orderUrl,
      data: {
        first: { value: '您提交了新订单，请关注状态更新。' },
        keyword1: { value: displayOrderNo },
        keyword2: { value: projectTitle },
        keyword3: { value: formatMoney(order.totalAmount) },
        remark: { value: '点击查看订单详情。' },
      },
    };

    try {
      const sendResult = await sendWechatTemplateMessage(payload);
      await orderRef.set(
        {
          wechatOrderSubmittedNotification: {
            status: 'sent',
            msgId: sendResult.msgid || null,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, sent: true });
    } catch (e) {
      console.error('wechatOrderSubmittedNotify', e);
      await orderRef.set(
        {
          wechatOrderSubmittedNotification: {
            status: 'failed',
            error: String((e && e.message) || e),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, sent: false, failed: true });
    }
  }
);
