import { useEffect, useRef } from 'react';
import { DEPLOY_BUILD_ID } from 'virtual:deploy-build-id';

/**
 * 部署后 PWA / 强缓存环境下，用户可能仍运行旧入口 HTML，引用的 hash JS 已被删除导致白屏或登录异常。
 * 构建时写入 /build-info.json，与虚拟模块注入的 DEPLOY_BUILD_ID 比对；不一致则整页刷新以加载新资源。
 */
export function useDeployVersionReload() {
  const checking = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const embedded = DEPLOY_BUILD_ID;
    if (!embedded || embedded === 'dev') return;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const res = await fetch(`/build-info.json?${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (data.buildId && data.buildId !== embedded) {
          window.location.reload();
        }
      } catch {
        /* 离线或网络错误：不动当前会话 */
      } finally {
        checking.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };

    document.addEventListener('visibilitychange', onVisible);
    void check();

    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}
