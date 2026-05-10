import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { RegisteredUserDoc } from '../types/firestore';
import { getDb } from './firebase';

const REGISTERED_USERS = 'registered_users';
const PLATFORM_ADMINS = 'platform_admins';

function maskPhone(phone: string | null): string | null {
  if (!phone || !phone.trim()) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****${digits.slice(-4)}`;
}

/**
 * 用户登录态出现时更新登记（手机号或匿名）。
 * Firestore 规则需允许用户写本人文档；管理员可读全集，见本文件末尾注释。
 */
export async function touchRegisteredUserFromAuth(user: User): Promise<void> {
  const db = getDb();
  const ref = doc(db, REGISTERED_USERS, user.uid);
  const snap = await getDoc(ref);
  const phoneMasked = maskPhone(user.phoneNumber);
  const isAnonymous = user.isAnonymous;
  const now = serverTimestamp();

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      phoneMasked,
      isAnonymous,
      firstSeenAt: now,
      lastSeenAt: now,
    } satisfies Omit<RegisteredUserDoc, 'firstSeenAt' | 'lastSeenAt'> & {
      firstSeenAt: ReturnType<typeof serverTimestamp>;
      lastSeenAt: ReturnType<typeof serverTimestamp>;
    });
    return;
  }

  await updateDoc(ref, {
    lastSeenAt: now,
    ...(phoneMasked ? { phoneMasked } : {}),
    isAnonymous,
  });
}

export async function isPlatformAdmin(uid: string): Promise<boolean> {
  const db = getDb();
  const snap = await getDoc(doc(db, PLATFORM_ADMINS, uid));
  return snap.exists();
}

export type RegisteredUserRow = { id: string; data: RegisteredUserDoc };

/** 按首次出现时间倒序列出（需 composite index：firstSeenAt DESC） */
export async function listRegisteredUsers(): Promise<RegisteredUserRow[]> {
  const db = getDb();
  const q = query(
    collection(db, REGISTERED_USERS),
    orderBy('firstSeenAt', 'desc'),
    limit(500)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as RegisteredUserDoc,
  }));
}

/*
 * --- Firestore 安全规则示例（请合并进项目 rules）---
 *
 * match /registered_users/{uid} {
 *   allow create: if request.auth != null && request.auth.uid == uid;
 *   allow update: if request.auth != null && request.auth.uid == uid;
 *   allow read: if request.auth != null && (
 *     request.auth.uid == uid ||
 *     exists(/databases/$(database)/documents/platform_admins/$(request.auth.uid))
 *   );
 * }
 * match /platform_admins/{adminUid} {
 *   allow read: if request.auth != null && request.auth.uid == adminUid;
 *   allow write: if false;
 * }
 *
 * 在 Firebase 控制台手动新增集合 platform_admins，文档 ID = 你的 Firebase Auth UID，
 * 内容可为空对象 {}，即可访问「用户登记」后台列表。
 */
