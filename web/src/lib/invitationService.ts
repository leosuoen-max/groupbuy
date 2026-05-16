import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
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

/** 店铺级管理员邀请：写入 permissions（scope=shop），按角色管理本店所有项目 */
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
 * 接受邀请：写入 permissions（仅店铺级）+ 标记邀请已使用（单次）
 */
export async function acceptInvitation(code: string, userId: string): Promise<void> {
  const c = code.trim();
  if (!c) throw new Error('邀请码无效');

  const invRow = await getInvitationByCode(c);
  if (!invRow) throw new Error('邀请不存在或已失效');
  if (invRow.data.usedBy) throw new Error('该邀请已被使用');
  if (invRow.data.expiresAt.toMillis() < Date.now()) {
    throw new Error('邀请已过期');
  }
  if (invRow.data.scope !== 'shop') {
    throw new Error(
      '项目级邀请已停用，请让店主在「管理员管理」中重新发送店铺邀请'
    );
  }
  const shopRow = invRow.data.shopId ? await getShopById(invRow.data.shopId) : null;
  if (!shopRow) throw new Error('店铺不存在');

  if (shopRow.data.ownerId === userId) {
    throw new Error('你是店铺创建人，无需通过邀请加入');
  }

  const db = getDb();
  const invRef = doc(db, 'invitations', c);
  const targetProjectId = '__shop__';
  const permRef = doc(db, 'permissions', permissionDocId(userId, targetProjectId));

  await runTransaction(db, async (tx) => {
    const invSnap = await tx.get(invRef);
    if (!invSnap.exists()) throw new Error('邀请不存在');
    const invData = invSnap.data() as InvitationDoc;
    if (invData.usedBy) throw new Error('该邀请已被使用');
    if (invData.expiresAt.toMillis() < Date.now()) {
      throw new Error('邀请已过期');
    }
    if (invData.scope !== 'shop') {
      throw new Error(
        '项目级邀请已停用，请让店主在「管理员管理」中重新发送店铺邀请'
      );
    }

    tx.set(
      permRef,
      {
        userId,
        projectId: targetProjectId,
        scope: 'shop',
        scopeId: shopRow.id,
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
