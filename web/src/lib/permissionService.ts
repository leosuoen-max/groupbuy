import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { getDb } from './firebase';
import type { PermissionDoc } from '../types/firestore';

export type PermissionRow = { id: string; data: PermissionDoc };

/**
 * 被邀请管理员的权限（创建人见 shops.ownerId，通常不在 permissions 里）
 * 见 docs/06 permissions
 */
export async function getProjectPermissionForUser(
  userId: string,
  projectId: string
): Promise<PermissionRow | null> {
  const db = getDb();
  const q = query(
    collection(db, 'permissions'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    limit(5)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, data: d.data() as PermissionDoc };
}
