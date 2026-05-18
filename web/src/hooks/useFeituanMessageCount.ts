import { useCallback, useEffect, useState } from 'react';
import { useAuthUser } from './useAuthUser';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { countFeituanActionableMessages } from '../lib/feituanMessageCount';
import { listFeituanOrdersForCustomer } from '../lib/orderService';
import { getWechatNotifyOAuthStateId } from '../lib/wechatService';

export function useFeituanMessageCount(): number {
  const { user, loading: authLoading } = useAuthUser();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (authLoading) return;
    try {
      const rows = await listFeituanOrdersForCustomer({
        customerKey: getOrCreateCustomerKey(),
        customerUserId: user?.phoneNumber ? user.uid : undefined,
        wechatNotifyOAuthStateId: getWechatNotifyOAuthStateId(),
      });
      setCount(countFeituanActionableMessages(rows.map((r) => r.data)));
    } catch {
      setCount(0);
    }
  }, [authLoading, user]);

  useEffect(() => {
    void refresh();
    const onRefresh = () => void refresh();
    window.addEventListener('feituan-messages-updated', onRefresh);
    window.addEventListener('focus', onRefresh);
    return () => {
      window.removeEventListener('feituan-messages-updated', onRefresh);
      window.removeEventListener('focus', onRefresh);
    };
  }, [refresh]);

  return count;
}

export function notifyFeituanMessagesUpdated(): void {
  window.dispatchEvent(new Event('feituan-messages-updated'));
}
