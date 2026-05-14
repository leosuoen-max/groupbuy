import { useEffect } from 'react';
import { ensureWechatNotifyOAuthState } from '../lib/wechatService';

export function useWechatNotifySession(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    ensureWechatNotifyOAuthState();
  }, [enabled]);
}
