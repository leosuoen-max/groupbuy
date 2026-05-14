import { useEffect, useState } from 'react';
import { getWechatJsSdkSignature, isWechatBrowser } from '../lib/wechatService';

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
  signatureOk: boolean;
  wxReady: boolean;
  wxError: string | null;
  error: string | null;
  userAgent: string;
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

declare global {
  interface Window {
    wx?: WxJsSdk;
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
  // iOS 微信在 SPA/replaceState 场景里通常校验首个落地 URL，而不是清理后的当前 URL。
  if (/MicroMessenger/i.test(ua) && /iPhone|iPad|iPod/i.test(ua) && initialWechatPageUrl) {
    return initialWechatPageUrl;
  }
  return pageUrlForWechatSignature(window.location.href);
}

function normalizeShareCard(card: WechatShareCard): WechatShareCard {
  return {
    title: card.title.trim(),
    desc: card.desc.trim(),
    link: card.link.trim(),
    imgUrl: card.imgUrl.trim(),
  };
}

function shouldShowDebugPanel(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debugWechatShare') === '1';
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
    shareCard: card ? applyDebugShareMode(normalizeShareCard(card)) : null,
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
    signatureOk: false,
    wxReady: false,
    wxError: null,
    error: null,
    userAgent: ua,
  };
}

export function useWechatShareCard(
  card: WechatShareCard | null | undefined
): WechatShareDebugState | null {
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

    const shareCard = applyDebugShareMode(normalizeShareCard(card));
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
    void (async () => {
      try {
        setDebugState((prev) => ({ ...prev, stage: 'loading_sdk_and_signature' }));
        const [wx, signature] = await Promise.all([
          loadWechatJsSdk(),
          getWechatJsSdkSignature(signatureUrl),
        ]);
        if (cancelled) return;

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
        wx.config({
          debug: false,
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
          setDebugState((prev) => ({
            ...prev,
            stage: 'wx_ready_setting_share_data',
            wxReady: true,
          }));
          const makePayload = (
            key:
              | 'appMessageSetStatus'
              | 'timelineSetStatus'
              | 'legacyAppMessageSetStatus'
              | 'legacyTimelineSetStatus'
          ): WxSharePayload => ({
            ...shareCard,
            trigger: (res) => {
              setDebugState((prev) => ({
                ...prev,
                [key]: `trigger:${errorText(res)}`,
              }));
            },
            success: (res) => {
              setDebugState((prev) => ({
                ...prev,
                [key]: `success:${errorText(res)}`,
              }));
            },
            fail: (res) => {
              setDebugState((prev) => ({
                ...prev,
                [key]: `fail:${errorText(res)}`,
              }));
            },
            cancel: (res) => {
              setDebugState((prev) => ({
                ...prev,
                [key]: `cancel:${errorText(res)}`,
              }));
            },
            complete: (res) => {
              setDebugState((prev) => ({
                ...prev,
                [key]: `complete:${errorText(res)}`,
              }));
            },
          });

          try {
            if (wx.updateAppMessageShareData) {
              setDebugState((prev) => ({ ...prev, appMessageSetStatus: 'calling' }));
              wx.updateAppMessageShareData(makePayload('appMessageSetStatus'));
            } else {
              setDebugState((prev) => ({ ...prev, appMessageSetStatus: 'missing_api' }));
            }
          } catch (e) {
            setDebugState((prev) => ({
              ...prev,
              appMessageSetStatus: `throw:${errorText(e)}`,
            }));
          }

          try {
            if (wx.updateTimelineShareData) {
              setDebugState((prev) => ({ ...prev, timelineSetStatus: 'calling' }));
              wx.updateTimelineShareData(makePayload('timelineSetStatus'));
            } else {
              setDebugState((prev) => ({ ...prev, timelineSetStatus: 'missing_api' }));
            }
          } catch (e) {
            setDebugState((prev) => ({
              ...prev,
              timelineSetStatus: `throw:${errorText(e)}`,
            }));
          }

          try {
            if (wx.onMenuShareAppMessage) {
              setDebugState((prev) => ({ ...prev, legacyAppMessageSetStatus: 'calling' }));
              wx.onMenuShareAppMessage(makePayload('legacyAppMessageSetStatus'));
            } else {
              setDebugState((prev) => ({ ...prev, legacyAppMessageSetStatus: 'missing_api' }));
            }
          } catch (e) {
            setDebugState((prev) => ({
              ...prev,
              legacyAppMessageSetStatus: `throw:${errorText(e)}`,
            }));
          }

          try {
            if (wx.onMenuShareTimeline) {
              setDebugState((prev) => ({ ...prev, legacyTimelineSetStatus: 'calling' }));
              wx.onMenuShareTimeline(makePayload('legacyTimelineSetStatus'));
            } else {
              setDebugState((prev) => ({ ...prev, legacyTimelineSetStatus: 'missing_api' }));
            }
          } catch (e) {
            setDebugState((prev) => ({
              ...prev,
              legacyTimelineSetStatus: `throw:${errorText(e)}`,
            }));
          }

          setDebugState((prev) => ({
            ...prev,
            stage: 'wx_ready_share_api_called',
          }));
        });
        wx.error((err) => {
          console.warn('wechat share config failed', err);
          setDebugState((prev) => ({
            ...prev,
            stage: 'wx_error',
            wxError: errorText(err),
          }));
        });
      } catch (e) {
        console.warn('wechat share setup failed', e);
        setDebugState((prev) => ({
          ...prev,
          stage: 'setup_error',
          error: errorText(e),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [card]);

  return debugState.enabled ? debugState : null;
}
