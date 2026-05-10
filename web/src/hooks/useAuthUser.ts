import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { getAuthClient } from '../lib/firebase';
import { touchRegisteredUserFromAuth } from '../lib/registeredUserService';

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuthClient();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        void touchRegisteredUserFromAuth(u).catch(() => {
          /* 规则未部署或离线：静默忽略，避免打断登录 */
        });
      }
    });
    return () => unsub();
  }, []);

  return { user, loading };
}
