import { useCallback, useEffect, useState } from 'react';
import {
  feituanCartProjectCount,
  getFeituanCart,
} from '../lib/feituanCartStorage';

export function useFeituanCartCount(): number {
  const [count, setCount] = useState(() => feituanCartProjectCount());

  const refresh = useCallback(() => {
    setCount(feituanCartProjectCount(getFeituanCart()));
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'feituanCart') refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('feituan-cart-updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('feituan-cart-updated', refresh);
    };
  }, [refresh]);

  return count;
}

export function notifyFeituanCartUpdated(): void {
  window.dispatchEvent(new Event('feituan-cart-updated'));
}
