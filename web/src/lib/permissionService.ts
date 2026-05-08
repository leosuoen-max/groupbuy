import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
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

/** 列出某项目下全部管理员权限（不含 owner） */
export async function listProjectPermissions(
  projectId: string
): Promise<PermissionRow[]> {
  const db = getDb();
  const q = query(
    collection(db, 'permissions'),
    where('projectId', '==', projectId),
    limit(500)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((d) => ({ id: d.id, data: d.data() as PermissionDoc }))
    .filter((r) => r.data.role === 'normal_admin' || r.data.role === 'high_admin');
  rows.sort((a, b) => {
    const ta = a.data.grantedAt?.toMillis?.() ?? 0;
    const tb = b.data.grantedAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

/** 店铺管理员池（scope=shop） */
export async function listShopAdminPermissions(shopId: string): Promise<PermissionRow[]> {
  const db = getDb();
  const q = query(collection(db, 'permissions'), where('scopeId', '==', shopId), limit(500));
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((d) => ({ id: d.id, data: d.data() as PermissionDoc }))
    .filter(
      (r) =>
        r.data.scope === 'shop' &&
        (r.data.role === 'normal_admin' || r.data.role === 'high_admin')
    );
  rows.sort((a, b) => {
    const ta = a.data.grantedAt?.toMillis?.() ?? 0;
    const tb = b.data.grantedAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

/** 项目管理员改角色（普通/高级） */
export async function updateProjectPermissionRole(params: {
  permissionId: string;
  role: 'normal_admin' | 'high_admin';
}): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, 'permissions', params.permissionId), {
    role: params.role,
  });
}

/** 移除项目管理员权限 */
export async function removeProjectPermission(permissionId: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'permissions', permissionId));
}

/** 项目编辑保存时：按店铺管理员池同步项目管理员权限 */
export async function syncProjectAdminsFromShopPool(params: {
  projectId: string;
  shopId: string;
  selectedUserIds: string[];
  grantedBy: string;
}): Promise<void> {
  const db = getDb();
  const selected = new Set(params.selectedUserIds.map((x) => x.trim()).filter(Boolean));
  const [shopAdmins, projectPerms] = await Promise.all([
    listShopAdminPermissions(params.shopId),
    listProjectPermissions(params.projectId),
  ]);
  const shopRoleMap = new Map(shopAdmins.map((x) => [x.data.userId, x.data.role]));
  const existingMap = new Map(projectPerms.map((x) => [x.data.userId, x]));

  const tasks: Promise<unknown>[] = [];

  for (const userId of selected) {
    const role = shopRoleMap.get(userId);
    if (!role) continue; // 仅允许店铺管理员池内成员被分配到项目
    const ref = doc(db, 'permissions', `${userId}_${params.projectId}`);
    tasks.push(
      setDoc(
        ref,
        {
          userId,
          projectId: params.projectId,
          scope: 'project',
          scopeId: params.projectId,
          role,
          grantedBy: params.grantedBy,
          grantedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );
  }

  for (const [userId, row] of existingMap.entries()) {
    if (!selected.has(userId)) {
      tasks.push(deleteDoc(doc(db, 'permissions', row.id)));
    }
  }

  await Promise.all(tasks);
}
