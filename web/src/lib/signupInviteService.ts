import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { isPlatformAdmin } from './registeredUserService';

const COLL = 'signup_invites';

/** 邀请链接默认有效时长 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SignupInviteDoc = {
  used: boolean;
  usedAt?: Timestamp;
  usedByUid?: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  createdByUid: string;
};

export type InviteGateResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'used' | 'expired' };

export async function createSignupInvite(createdByUid: string): Promise<string> {
  if (!(await isPlatformAdmin(createdByUid))) {
    throw new Error('PLATFORM_ADMIN_REQUIRED');
  }
  const token = crypto.randomUUID();
  const db = getDb();
  const ref = doc(db, COLL, token);
  await setDoc(ref, {
    used: false,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
    createdByUid,
  });
  return token;
}

export async function getInviteGate(token: string): Promise<InviteGateResult> {
  const t = token.trim();
  if (!t) return { ok: false, reason: 'not_found' };
  const db = getDb();
  const snap = await getDoc(doc(db, COLL, t));
  if (!snap.exists()) return { ok: false, reason: 'not_found' };
  const data = snap.data() as Partial<SignupInviteDoc>;
  if (data.used) return { ok: false, reason: 'used' };
  const exp = data.expiresAt;
  const expMs = exp?.toMillis?.() ?? 0;
  if (expMs < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/**
 * 注册成功后调用：将邀请标为已使用（同一 token 不可再用）。
 */
export async function consumeSignupInvite(token: string, uid: string): Promise<void> {
  const t = token.trim();
  if (!t || !uid.trim()) throw new Error('INVALID_ARGS');
  const db = getDb();
  const ref = doc(db, COLL, t);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('INVITE_NOT_FOUND');
    const data = snap.data() as Partial<SignupInviteDoc>;
    if (data.used) throw new Error('INVITE_ALREADY_USED');
    const expMs = data.expiresAt?.toMillis?.() ?? 0;
    if (expMs < Date.now()) throw new Error('INVITE_EXPIRED');
    tx.update(ref, {
      used: true,
      usedAt: serverTimestamp(),
      usedByUid: uid,
    });
  });
}
