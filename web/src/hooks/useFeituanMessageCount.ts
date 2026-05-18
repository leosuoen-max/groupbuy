import { useCallback, useEffect, useState } from 'react';
import { useAuthUser } from './useAuthUser';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { computeFeituanTabBadgeFromRows } from '../lib/feituanMessages';
import { listFeituanOrdersForCustomer } from '../lib/orderService';
import { getWechatNotifyOAuthStateId } from '../lib/wechatService';

export function useFeituanMessageCount(): number {
  const { user, loading: authLoading } = useAuthUser();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (authLoading) return;
    try {
      const customerKey = getOrCreateCustomerKey();
      const rows = await listFeituanOrdersForCustomer({
        customerKey,
        customerUserId: user?.phoneNumber ? user.uid : undefined,
        wechatNotifyOAuthStateId: getWechatNotifyOAuthStateId(),
      });
      setCount(computeFeituanTabBadgeFromRows(rows, customerKey));
    } catch {
      setCount(0);
    }
  }, [authLoading, user]);

  useEffect(() => {
    void refresh();
    const onRefresh = () => void refresh();
    window.addEventListener('feituan-messages-updated', onRefresh);
    window.addEventListener('focus', onRefresh);
    window.addEventListener('storage', onRefresh);
    return () => {
      window.removeEventListener('feituan-messages-updated', onRefresh);
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('storage', onRefresh);
    };
  }, [refresh]);

  return count;
}

export function notifyFeituanMessagesUpdated(): void {
  window.dispatchEvent(new Event('feituan-messages-updated'));
}
