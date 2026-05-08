import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { getProject } from './projectService';
import { getShopById } from './shopService';
import type { InvitationDoc } from '../types/firestore';

const INV_TTL_MS = 24 * 60 * 60 * 1000;

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/**
 * 项目级管理员邀请（见 docs/02、04、06）
 * 文档 ID = code，避免按 code 查询与复合索引
 */
export async function createProjectInvitation(input: {
  projectId: string;
  shopId: string;
  role: 'high_admin' | 'normal_admin';
  invitedBy: string;
}): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const ref = doc(db, 'invitations', code);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;

    const expiresAt = Timestamp.fromMillis(Date.now() + INV_TTL_MS);
    await setDoc(ref, {
      code,
      projectId: input.projectId,
      shopId: input.shopId,
      scope: 'project',
      role: input.role,
      invitedBy: input.invitedBy,
      expiresAt,
      createdAt: serverTimestamp(),
    });

    return code;
  }
  throw new Error('无法生成唯一邀请码，请重试');
}

/** 店铺级管理员邀请：先进入店铺管理员池，再由项目编辑分配项目权限 */
export async function createShopInvitation(input: {
  shopId: string;
  role: 'high_admin' | 'normal_admin';
  invitedBy: string;
}): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const ref = doc(db, 'invitations', code);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;
    const expiresAt = Timestamp.fromMillis(Date.now() + INV_TTL_MS);
    await setDoc(ref, {
      code,
      shopId: input.shopId,
      scope: 'shop',
      role: input.role,
      invitedBy: input.invitedBy,
      expiresAt,
      createdAt: serverTimestamp(),
    });
    return code;
  }
  throw new Error('无法生成唯一邀请码，请重试');
}

export async function getInvitationByCode(
  code: string
): Promise<{ id: string; data: InvitationDoc } | null> {
  const c = code.trim();
  if (!c) return null;
  const db = getDb();
  const ref = doc(db, 'invitations', c);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as InvitationDoc };
}

function permissionDocId(userId: string, projectId: string): string {
  return `${userId}_${projectId}`;
}

/**
 * 接受邀请：写入 permissions + 标记邀请已使用（单次）
 */
export async function acceptProjectInvitation(
  code: string,
  userId: string
): Promise<void> {
  const c = code.trim();
  if (!c) throw new Error('邀请码无效');

  const invRow = await getInvitationByCode(c);
  if (!invRow) throw new Error('邀请不存在或已失效');
  if (invRow.data.usedBy) throw new Error('该邀请已被使用');
  if (invRow.data.expiresAt.toMillis() < Date.now()) {
    throw new Error('邀请已过期');
  }
  const shopRow = invRow.data.shopId ? await getShopById(invRow.data.shopId) : null;
  if (!shopRow) throw new Error('店铺不存在');

  if (shopRow.data.ownerId === userId) {
    throw new Error('你是店铺创建人，无需通过邀请加入');
  }

  const db = getDb();
  const invRef = doc(db, 'invitations', c);
  const project = invRow.data.projectId ? await getProject(invRow.data.projectId) : null;
  if (invRow.data.scope === 'project') {
    if (!project) throw new Error('项目不存在');
    if (project.data.shopId !== shopRow.id) {
      throw new Error('项目与店铺不匹配');
    }
  }
  const targetProjectId =
    invRow.data.scope === 'project' ? invRow.data.projectId ?? '' : '__shop__';
  const permRef = doc(db, 'permissions', permissionDocId(userId, targetProjectId));

  await runTransaction(db, async (tx) => {
    const invSnap = await tx.get(invRef);
    if (!invSnap.exists()) throw new Error('邀请不存在');
    const invData = invSnap.data() as InvitationDoc;
    if (invData.usedBy) throw new Error('该邀请已被使用');
    if (invData.expiresAt.toMillis() < Date.now()) {
      throw new Error('邀请已过期');
    }

    tx.set(
      permRef,
      {
        userId,
        projectId: targetProjectId,
        scope: invData.scope,
        scopeId: invData.scope === 'shop' ? shopRow.id : invData.projectId,
        role: invData.role,
        grantedBy: invData.invitedBy,
        invitationId: invRef.id,
        grantedAt: serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(invRef, {
      usedAt: serverTimestamp(),
      usedBy: userId,
    });
  });
}
