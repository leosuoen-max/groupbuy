import { useEffect, useState } from 'react';
import { getWechatJsSdkSignature, isWechatBrowser } from '../lib/wechatService';
import { toWechatJsSdkShareCard } from '../lib/wechatShareMeta';

export type WechatShareCard = {
  title: string;
  desc: string;
  link: string;
  imgUrl: string;
};

export type WechatShareDebugState = {
  enabled: boolean;
  debugShareMode: string;
  isWechat: boolean;
  stage: string;
  pageUrl: string;
  signatureUrl: string;
  shareCard: WechatShareCard | null;
  apiSupport: {
    updateAppMessageShareData: boolean;
    updateTimelineShareData: boolean;
    onMenuShareAppMessage: boolean;
    onMenuShareTimeline: boolean;
  };
  appMessageSetStatus: string;
  timelineSetStatus: string;
  legacyAppMessageSetStatus: string;
  legacyTimelineSetStatus: string;
  bridgeBound: boolean;
  signatureOk: boolean;
  wxReady: boolean;
  wxError: string | null;
  error: string | null;
  userAgent: string;
};

export type UseWechatShareCardResult = {
  /** `?debugWechatShare=1` 时才有 */
  debug: WechatShareDebugState | null;
  /** 签名成功且 wx.ready（右上角分享应带标题/缩略图） */
  ready: boolean;
  setupError: string | null;
};

type WxReadyCallback = () => void;
type WxErrorCallback = (err: unknown) => void;

type WxJsSdk = {
  config: (config: {
    debug: boolean;
    appId: string;
    timestamp: number;
    nonceStr: string;
    signature: string;
    jsApiList: string[];
  }) => void;
  ready: (callback: WxReadyCallback) => void;
  error: (callback: WxErrorCallback) => void;
  updateAppMessageShareData?: (data: WxSharePayload) => void;
  updateTimelineShareData?: (data: WxSharePayload) => void;
  onMenuShareAppMessage?: (data: WxSharePayload) => void;
  onMenuShareTimeline?: (data: WxSharePayload) => void;
};

type WxCallback = (res: unknown) => void;
type WxSharePayload = WechatShareCard & {
  trigger?: WxCallback;
  success?: WxCallback;
  fail?: WxCallback;
  cancel?: WxCallback;
  complete?: WxCallback;
};

type WeixinJSBridgeLike = {
  on: (event: string, cb: () => void) => void;
  invoke: (method: string, args: Record<string, string>, cb?: () => void) => void;
};

declare global {
  interface Window {
    wx?: WxJsSdk;
    WeixinJSBridge?: WeixinJSBridgeLike;
    __dmftWeixinBridgeBound?: boolean;
    __dmftLatestWechatShareCard?: WechatShareCard;
  }
}

const WECHAT_JS_SDK_SRC = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';

let wxScriptPromise: Promise<WxJsSdk> | null = null;

function pageUrlForWechatSignature(href: string): string {
  const url = new URL(href);
  url.hash = '';
  return url.toString();
}

const initialWechatPageUrl =
  typeof window !== 'undefined' ? pageUrlForWechatSignature(window.location.href) : '';

function loadWechatJsSdk(): Promise<WxJsSdk> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('not in browser'));
  }
  if (window.wx) return Promise.resolve(window.wx);
  if (wxScriptPromise) return wxScriptPromise;

  wxScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${WECHAT_JS_SDK_SRC}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.wx) resolve(window.wx);
        else reject(new Error('微信 JS-SDK 加载失败'));
      });
      existing.addEventListener('error', () => reject(new Error('微信 JS-SDK 加载失败')));
      return;
    }

    const script = document.createElement('script');
    script.src = WECHAT_JS_SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (window.wx) resolve(window.wx);
      else reject(new Error('微信 JS-SDK 加载失败'));
    };
    script.onerror = () => reject(new Error('微信 JS-SDK 加载失败'));
    document.head.appendChild(script);
  });
  return wxScriptPromise;
}

function currentPageUrlForWechatSignature(): string {
  const ua = navigator.userAgent || '';
  if (/MicroMessenger/i.test(ua) && /iPhone|iPad|iPod/i.test(ua) && initialWechatPageUrl) {
    return initialWechatPageUrl;
  }
  return pageUrlForWechatSignature(window.location.href);
}

function shouldShowDebugPanel(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debugWechatShare') === '1';
}

function shouldWxConfigDebug(): boolean {
  return shouldShowDebugPanel();
}

function getDebugShareMode(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('debugShareMode')?.trim() ?? '';
}

function currentPageShareUrl(): string {
  if (typeof window === 'undefined') return '';
  return pageUrlForWechatSignature(window.location.href);
}

function withoutDebugParams(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('debugWechatShare');
    u.searchParams.delete('debugShareMode');
    u.searchParams.delete('t');
    return u.toString();
  } catch {
    return url;
  }
}

function applyDebugShareMode(card: WechatShareCard): WechatShareCard {
  const mode = getDebugShareMode();
  if (!shouldShowDebugPanel() || !mode) return card;
  const currentUrl = withoutDebugParams(currentPageShareUrl());
  const simpleImg =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Red_silk_cotton_tree_flower.jpg/320px-Red_silk_cotton_tree_flower.jpg';
  if (mode === 'current') {
    return { ...card, link: currentUrl };
  }
  if (mode === 'simple') {
    return {
      title: '测试分享',
      desc: '测试描述',
      link: currentUrl,
      imgUrl: simpleImg,
    };
  }
  if (mode === 'noImageStorage') {
    return {
      ...card,
      imgUrl: simpleImg,
    };
  }
  if (mode === 'simpleShareLink') {
    return {
      title: '测试分享',
      desc: '测试描述',
      link: card.link,
      imgUrl: simpleImg,
    };
  }
  return card;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** iOS 微信要求分享 link 与 wx.config 签名所用 URL 一致，否则 updateAppMessageShareData 常 retCode:-1 */
function menuLinkMatchingSignature(fallbackLink: string): string {
  if (typeof window === 'undefined') return fallbackLink;
  return currentPageUrlForWechatSignature() || fallbackLink;
}

function prepareShareCard(card: WechatShareCard): WechatShareCard {
  const base = applyDebugShareMode(card);
  const menuLink = menuLinkMatchingSignature(base.link);
  const prepared = toWechatJsSdkShareCard(base, { menuLink });
  if (typeof window !== 'undefined') {
    window.__dmftLatestWechatShareCard = prepared;
  }
  return prepared;
}

function bindWeixinJSBridgeMenuShare(): boolean {
  const bridge = window.WeixinJSBridge;
  if (!bridge) return false;
  if (window.__dmftWeixinBridgeBound) return true;

  bridge.on('menu:share:appmessage', () => {
    const c = window.__dmftLatestWechatShareCard;
    if (!c) return;
    bridge.invoke(
      'sendAppMessage',
      {
        title: c.title,
        desc: c.desc,
        link: c.link,
        img_url: c.imgUrl,
        type: 'link',
        data_url: '',
      },
      () => {}
    );
  });
  bridge.on('menu:share:timeline', () => {
    const c = window.__dmftLatestWechatShareCard;
    if (!c) return;
    bridge.invoke(
      'shareTimeline',
      {
        title: c.title,
        link: c.link,
        img_url: c.imgUrl,
      },
      () => {}
    );
  });
  window.__dmftWeixinBridgeBound = true;
  return true;
}

function ensureWeixinJSBridgeMenuShare(): void {
  if (bindWeixinJSBridgeMenuShare()) return;
  document.addEventListener('WeixinJSBridgeReady', () => bindWeixinJSBridgeMenuShare(), {
    once: true,
  });
}

function pushAppMessageShareData(
  wx: WxJsSdk,
  shareCard: WechatShareCard,
  statusKey: string,
  onStatus?: (key: string, status: string) => void
): void {
  if (!wx.updateAppMessageShareData) {
    onStatus?.(statusKey, 'missing_api');
    return;
  }
  onStatus?.(statusKey, 'calling');
  wx.updateAppMessageShareData({
    title: shareCard.title,
    desc: shareCard.desc,
    link: shareCard.link,
    imgUrl: shareCard.imgUrl,
    success: (res) => onStatus?.(statusKey, `success:${errorText(res)}`),
    fail: (res) => onStatus?.(statusKey, `fail:${errorText(res)}`),
    cancel: (res) => onStatus?.(statusKey, `cancel:${errorText(res)}`),
    complete: (res) => onStatus?.(statusKey, `complete:${errorText(res)}`),
  });
}

function pushTimelineShareData(
  wx: WxJsSdk,
  shareCard: WechatShareCard,
  statusKey: string,
  onStatus?: (key: string, status: string) => void
): void {
  if (!wx.updateTimelineShareData) {
    onStatus?.(statusKey, 'missing_api');
    return;
  }
  onStatus?.(statusKey, 'calling');
  wx.updateTimelineShareData({
    title: shareCard.title,
    desc: shareCard.desc,
    link: shareCard.link,
    imgUrl: shareCard.imgUrl,
    success: (res) => onStatus?.(statusKey, `success:${errorText(res)}`),
    fail: (res) => onStatus?.(statusKey, `fail:${errorText(res)}`),
    cancel: (res) => onStatus?.(statusKey, `cancel:${errorText(res)}`),
    complete: (res) => onStatus?.(statusKey, `complete:${errorText(res)}`),
  });
}

function registerWxShareApis(
  wx: WxJsSdk,
  shareCard: WechatShareCard,
  onStatus?: (key: string, status: string) => void
): void {
  const legacyAppPayload: WxSharePayload = {
    title: shareCard.title,
    desc: shareCard.desc,
    link: shareCard.link,
    imgUrl: shareCard.imgUrl,
    trigger: (res) => {
      onStatus?.('legacyAppMessageSetStatus', `trigger:${errorText(res)}`);
      // iOS：在用户点开分享菜单时再写入，避免 ready 时 retCode:-1
      pushAppMessageShareData(wx, shareCard, 'appMessageSetStatus', onStatus);
    },
    success: (res) => onStatus?.('legacyAppMessageSetStatus', `success:${errorText(res)}`),
    fail: (res) => onStatus?.('legacyAppMessageSetStatus', `fail:${errorText(res)}`),
    cancel: (res) => onStatus?.('legacyAppMessageSetStatus', `cancel:${errorText(res)}`),
  };

  const legacyTimelinePayload: WxSharePayload = {
    title: shareCard.title,
    desc: shareCard.desc,
    link: shareCard.link,
    imgUrl: shareCard.imgUrl,
    trigger: (res) => {
      onStatus?.('legacyTimelineSetStatus', `trigger:${errorText(res)}`);
      pushTimelineShareData(wx, shareCard, 'timelineSetStatus', onStatus);
    },
    success: (res) => onStatus?.('legacyTimelineSetStatus', `success:${errorText(res)}`),
    fail: (res) => onStatus?.('legacyTimelineSetStatus', `fail:${errorText(res)}`),
    cancel: (res) => onStatus?.('legacyTimelineSetStatus', `cancel:${errorText(res)}`),
  };

  if (wx.onMenuShareAppMessage) {
    try {
      wx.onMenuShareAppMessage(legacyAppPayload);
      onStatus?.('legacyAppMessageSetStatus', 'registered');
    } catch (e) {
      onStatus?.('legacyAppMessageSetStatus', `throw:${errorText(e)}`);
    }
  } else {
    onStatus?.('legacyAppMessageSetStatus', 'missing_api');
    pushAppMessageShareData(wx, shareCard, 'appMessageSetStatus', onStatus);
  }

  if (wx.onMenuShareTimeline) {
    try {
      wx.onMenuShareTimeline(legacyTimelinePayload);
      onStatus?.('legacyTimelineSetStatus', 'registered');
    } catch (e) {
      onStatus?.('legacyTimelineSetStatus', `throw:${errorText(e)}`);
    }
  } else {
    onStatus?.('legacyTimelineSetStatus', 'missing_api');
    pushTimelineShareData(wx, shareCard, 'timelineSetStatus', onStatus);
  }

  ensureWeixinJSBridgeMenuShare();
}

function makeInitialDebugState(card: WechatShareCard | null | undefined): WechatShareDebugState {
  const hasWindow = typeof window !== 'undefined';
  const ua = hasWindow ? navigator.userAgent || '' : '';
  return {
    enabled: shouldShowDebugPanel(),
    debugShareMode: getDebugShareMode(),
    isWechat: isWechatBrowser(),
    stage: card ? 'init' : 'waiting_card',
    pageUrl: hasWindow ? window.location.href : '',
    signatureUrl: '',
    shareCard: card ? prepareShareCard(card) : null,
    apiSupport: {
      updateAppMessageShareData: false,
      updateTimelineShareData: false,
      onMenuShareAppMessage: false,
      onMenuShareTimeline: false,
    },
    appMessageSetStatus: 'idle',
    timelineSetStatus: 'idle',
    legacyAppMessageSetStatus: 'idle',
    legacyTimelineSetStatus: 'idle',
    bridgeBound: false,
    signatureOk: false,
    wxReady: false,
    wxError: null,
    error: null,
    userAgent: ua,
  };
}

export function useWechatShareCard(
  card: WechatShareCard | null | undefined
): UseWechatShareCardResult {
  const [debugState, setDebugState] = useState<WechatShareDebugState>(() =>
    makeInitialDebugState(card)
  );

  useEffect(() => {
    const debugEnabled = shouldShowDebugPanel();
    const wechat = isWechatBrowser();
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

    if (!card) {
      setDebugState(makeInitialDebugState(card));
      return;
    }

    const shareCard = prepareShareCard(card);
    const signatureUrl = typeof window !== 'undefined' ? currentPageUrlForWechatSignature() : '';

    setDebugState({
      enabled: debugEnabled,
      debugShareMode: getDebugShareMode(),
      isWechat: wechat,
      stage: !wechat ? 'not_wechat_browser' : 'card_ready',
      pageUrl,
      signatureUrl,
      shareCard,
      apiSupport: {
        updateAppMessageShareData: false,
        updateTimelineShareData: false,
        onMenuShareAppMessage: false,
        onMenuShareTimeline: false,
      },
      appMessageSetStatus: 'idle',
      timelineSetStatus: 'idle',
      legacyAppMessageSetStatus: 'idle',
      legacyTimelineSetStatus: 'idle',
      bridgeBound: Boolean(window.__dmftWeixinBridgeBound),
      signatureOk: false,
      wxReady: false,
      wxError: null,
      error: null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
    });

    if (!wechat) return;
    if (!shareCard.title || !shareCard.link) {
      setDebugState((prev) => ({
        ...prev,
        stage: 'invalid_share_card',
        error: 'missing title or link',
      }));
      return;
    }

    let cancelled = false;
    let wxRef: WxJsSdk | null = null;

    const applyShareRegistration = () => {
      if (!wxRef || cancelled) return;
      registerWxShareApis(wxRef, shareCard, (key, status) => {
        setDebugState((prev) => ({ ...prev, [key]: status }));
      });
      setDebugState((prev) => ({
        ...prev,
        stage: 'wx_ready_share_api_called',
        bridgeBound: Boolean(window.__dmftWeixinBridgeBound),
      }));
    };

    const onPageShow = () => {
      if (wxRef && !cancelled) applyShareRegistration();
    };

    void (async () => {
      try {
        setDebugState((prev) => ({ ...prev, stage: 'loading_sdk_and_signature' }));
        const [wx, signature] = await Promise.all([
          loadWechatJsSdk(),
          getWechatJsSdkSignature(signatureUrl),
        ]);
        if (cancelled) return;
        wxRef = wx;

        setDebugState((prev) => ({
          ...prev,
          stage: 'signature_ok_configuring_wx',
          signatureOk: true,
          apiSupport: {
            updateAppMessageShareData: typeof wx.updateAppMessageShareData === 'function',
            updateTimelineShareData: typeof wx.updateTimelineShareData === 'function',
            onMenuShareAppMessage: typeof wx.onMenuShareAppMessage === 'function',
            onMenuShareTimeline: typeof wx.onMenuShareTimeline === 'function',
          },
        }));

        // 旧版 Bridge 尽早挂上，避免仅依赖 updateAppMessageShareData（iOS 常失败）
        ensureWeixinJSBridgeMenuShare();

        wx.config({
          debug: shouldWxConfigDebug(),
          appId: signature.appId,
          timestamp: signature.timestamp,
          nonceStr: signature.nonceStr,
          signature: signature.signature,
          jsApiList: [
            'updateAppMessageShareData',
            'updateTimelineShareData',
            'onMenuShareAppMessage',
            'onMenuShareTimeline',
          ],
        });

        wx.ready(() => {
          if (cancelled) return;
          setDebugState((prev) => ({
            ...prev,
            stage: 'wx_ready_setting_share_data',
            wxReady: true,
          }));
          applyShareRegistration();
          window.setTimeout(() => applyShareRegistration(), 300);
        });

        wx.error((err) => {
          console.warn('wechat share config failed', err);
          setDebugState((prev) => ({
            ...prev,
            stage: 'wx_error',
            wxError: errorText(err),
          }));
          ensureWeixinJSBridgeMenuShare();
        });
      } catch (e) {
        console.warn('wechat share setup failed', e);
        setDebugState((prev) => ({
          ...prev,
          stage: 'setup_error',
          error: errorText(e),
        }));
        ensureWeixinJSBridgeMenuShare();
      }
    })();

    window.addEventListener('pageshow', onPageShow);

    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [card]);

  const ready = debugState.wxReady && debugState.signatureOk;
  const setupError = debugState.wxError || debugState.error;

  return {
    debug: debugState.enabled ? debugState : null,
    ready,
    setupError,
  };
}
