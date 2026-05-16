import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { getProject } from './projectService';
import type { ShopRow } from './shopService';
import type { PermissionDoc } from '../types/firestore';

export type PermissionRow = { id: string; data: PermissionDoc };

/** 店员身份：店主 / 受邀高级 / 受邀普通（不包含未授权） */
export type MerchantShopActorRole = 'owner' | 'high_admin' | 'normal_admin';

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

/** 当前账号在某店铺的受邀店铺级权限（scope=shop）；若无可返回 null */
export async function getShopPermissionForUser(
  userId: string,
  shopId: string
): Promise<PermissionRow | null> {
  const db = getDb();
  const q = query(
    collection(db, 'permissions'),
    where('userId', '==', userId),
    where('scope', '==', 'shop'),
    where('scopeId', '==', shopId),
    limit(5)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, data: d.data() as PermissionDoc };
}

/**
 * 历史数据：仅存 project scope 的旧管理员；升级到「整店管理员」前应仍能登录。
 * 若多个项目条目角色不同，取最高（high_admin 优先）。
 */
export async function getLegacyHighestProjectAdminRoleForShop(
  userId: string,
  shopId: string
): Promise<'high_admin' | 'normal_admin' | null> {
  const db = getDb();
  const q = query(
    collection(db, 'permissions'),
    where('userId', '==', userId),
    where('scope', '==', 'project'),
    limit(320)
  );
  const snap = await getDocs(q);
  let best: 'high_admin' | 'normal_admin' | null = null;
  const cache = new Map<string, string | null>();
  for (const ds of snap.docs) {
    const data = ds.data() as PermissionDoc;
    if (data.role !== 'high_admin' && data.role !== 'normal_admin') continue;
    const pid = (data.projectId ?? '').trim();
    if (!pid) continue;
    let sid = cache.get(pid);
    if (sid === undefined) {
      const row = await getProject(pid);
      sid = row?.data.shopId ?? null;
      cache.set(pid, sid ?? null);
    }
    if (sid !== shopId) continue;
    if (data.role === 'high_admin') return 'high_admin';
    if (!best) best = 'normal_admin';
  }
  return best;
}

/** 店员在本店的有效角色：店主优先；否则店铺邀请；否则历史 project-scope 回填 */
export async function resolveMerchantShopRole(
  actorUid: string,
  shop: ShopRow
): Promise<MerchantShopActorRole | null> {
  if (shop.data.ownerId === actorUid) return 'owner';
  const invited = await getShopPermissionForUser(actorUid, shop.id);
  if (
    invited &&
    invited.data.scope === 'shop' &&
    (invited.data.role === 'high_admin' || invited.data.role === 'normal_admin')
  ) {
    return invited.data.role;
  }
  const legacy = await getLegacyHighestProjectAdminRoleForShop(actorUid, shop.id);
  return legacy ?? null;
}

/** 订单、对账等店员入口（含普通管理员） */
export function merchantHasShopStaffAccess(role: MerchantShopActorRole | null): boolean {
  return role !== null;
}

/** 项目管理、配送点库、店铺设置等（店主 + 高级管理员） */
export function merchantCanManageShopSettingsAndProjects(
  role: MerchantShopActorRole | null
): boolean {
  return role === 'owner' || role === 'high_admin';
}

/** 「管理员管理」页：仅店主 */
export function merchantCanManageAdminInvitations(role: MerchantShopActorRole | null): boolean {
  return role === 'owner';
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
