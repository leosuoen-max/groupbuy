import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  orderHasPaymentScreenshots,
  withDefaultScreenshotFlagIfUrl,
} from './paymentScreenshotHelpers';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { User } from 'firebase/auth';
import { getDb, getStorageClient } from './firebase';
import { isFeituanAdmin } from './feituanService';
import { buildPaymentGroups } from './paymentGroups';
import {
  hasOrderDeliverySlotLocked,
  resolveAndBuildDeliverySlotSnapshot,
} from './orderDeliverySlot';
import { isProjectRecurring } from './recurringDeliverySchedule';
import type {
  FeituanWalletAccountDoc,
  FeituanWalletAppliedTierDoc,
  FeituanWalletLedgerDoc,
  FeituanWalletPaymentMethodDoc,
  FeituanWalletSettingsDoc,
  FeituanWalletTopupRequestDoc,
  FeituanWalletTopupTierDoc,
  OrderDoc,
  OrderFeituanWalletPaymentDoc,
  OrderStatus,
  ProjectDoc,
} from '../types/firestore';

const SETTINGS_COLL = 'feituan_wallet_settings';
const SETTINGS_ID = 'main';
const ACCOUNTS_COLL = 'feituan_wallet_accounts';
const REQUESTS_COLL = 'feituan_wallet_topup_requests';
const LEDGER_COLL = 'feituan_wallet_ledger';

const ROUND2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** 与 Firestore 写入值一致；旧数据 `pending` 按有无凭证拆成待付款 / 待核实 */
export function effectiveFeituanWalletTopupStatus(
  doc: FeituanWalletTopupRequestDoc
): 'awaiting_payment' | 'pending_review' | 'confirmed' | 'rejected' | 'cancelled' {
  const s = doc.status;
  if (s === 'confirmed' || s === 'rejected' || s === 'cancelled') return s;
  if (s === 'pending_review' || s === 'awaiting_payment') return s;
  if (s === 'pending') {
    return orderHasPaymentScreenshots(doc.paymentScreenshots)
      ? 'pending_review'
      : 'awaiting_payment';
  }
  return 'awaiting_payment';
}

/** 与订单顾客上传凭证三色规则对齐（跨申请 / 本申请 / 与申请创建时间） */
export function computeWalletTopupScreenshotRiskFlags(input: {
  md5Hex: string;
  createdAtMillis: number;
  uploadMillis: number;
  dupOtherRequests: boolean;
  dupSameRequest: boolean;
}): { flag: 'green' | 'yellow' | 'red'; flagReason?: string } {
  const md5 = input.md5Hex.trim();
  if (md5 && input.dupOtherRequests) {
    return { flag: 'red', flagReason: 'MD5 与其他充值申请截图重复' };
  }
  if (md5 && input.dupSameRequest) {
    return {
      flag: 'yellow',
      flagReason: '本申请已存在相同内容的截图（MD5 一致），请核对是否重复使用凭证',
    };
  }
  if (input.uploadMillis < input.createdAtMillis) {
    return { flag: 'yellow', flagReason: '截图上传时间早于申请创建时间' };
  }
  return { flag: 'green' };
}

function shotMd5FromUnknown(s: unknown): string | null {
  if (!s || typeof s !== 'object') return null;
  const h = (s as Record<string, unknown>).md5Hash;
  return typeof h === 'string' && h.trim() ? h.trim() : null;
}

async function md5DuplicateInOtherWalletTopups(
  excludeRequestId: string,
  md5: string
): Promise<boolean> {
  const m = md5.trim();
  if (!m) return false;
  const snap = await getDocs(collection(getDb(), REQUESTS_COLL));
  for (const d of snap.docs) {
    if (d.id === excludeRequestId) continue;
    const data = d.data() as FeituanWalletTopupRequestDoc;
    const shots = data.paymentScreenshots;
    if (!Array.isArray(shots)) continue;
    for (const s of shots) {
      if (shotMd5FromUnknown(s) === m) return true;
    }
  }
  return false;
}

export type FeituanWalletAccountRow = {
  id: string;
  data: FeituanWalletAccountDoc;
};

export type FeituanWalletTopupRequestRow = {
  id: string;
  data: FeituanWalletTopupRequestDoc;
};

export type FeituanWalletLedgerRow = {
  id: string;
  data: FeituanWalletLedgerDoc;
};

export type FeituanWalletTopupPreview = {
  payAmount: number;
  bonusAmount: number;
  creditAmount: number;
  appliedTiers: FeituanWalletAppliedTierDoc[];
};

export type FeituanWalletPaymentPlan =
  | {
      ok: true;
      walletId: string;
      balance: number;
      payAmount: number;
    }
  | {
      ok: false;
      reason: 'login_required' | 'no_wallet' | 'disabled' | 'insufficient' | 'no_unpaid';
      balance: number;
      payAmount: number;
      gap: number;
      message: string;
    };

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****${digits.slice(-4)}`;
}

function requirePhoneUser(user: User): { uid: string; phoneE164: string; phoneMasked: string | null } {
  const phoneE164 = user.phoneNumber?.trim();
  if (!phoneE164) throw new Error('请先完成手机号验证');
  return { uid: user.uid, phoneE164, phoneMasked: maskPhone(phoneE164) };
}

function cleanTiers(raw: FeituanWalletTopupTierDoc[] | undefined): FeituanWalletTopupTierDoc[] {
  return (raw ?? [])
    .map((tier, index) => ({
      id: tier.id?.trim() || `tier_${index + 1}`,
      ...(tier.label?.trim() ? { label: tier.label.trim() } : {}),
      payAmount: ROUND2(tier.payAmount),
      bonusAmount: ROUND2(tier.bonusAmount),
      isActive: tier.isActive !== false,
      sortOrder: Number.isFinite(Number(tier.sortOrder)) ? Number(tier.sortOrder) : index,
    }))
    .filter((tier) => tier.payAmount > 0 && tier.bonusAmount >= 0)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.payAmount - a.payAmount;
    });
}

function cleanPaymentMethods(
  raw: FeituanWalletPaymentMethodDoc[] | undefined
): FeituanWalletPaymentMethodDoc[] {
  return (raw ?? [])
    .map((method, index) => ({
      id: method.id?.trim() || `pm_${index + 1}`,
      name: method.name?.trim() || '收款码',
      qrCodeUrl: method.qrCodeUrl?.trim() || '',
      isActive: method.isActive !== false,
      sortOrder: Number.isFinite(Number(method.sortOrder)) ? Number(method.sortOrder) : index,
    }))
    .filter((method) => method.qrCodeUrl)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}

export function calculateFeituanWalletTopupPreview(
  rawPayAmount: number,
  tiers: FeituanWalletTopupTierDoc[]
): FeituanWalletTopupPreview {
  const payAmount = ROUND2(rawPayAmount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return { payAmount: 0, bonusAmount: 0, creditAmount: 0, appliedTiers: [] };
  }
  const active = cleanTiers(tiers)
    .filter((tier) => tier.isActive)
    .sort((a, b) => b.payAmount - a.payAmount);
  let remain = payAmount;
  const appliedTiers: FeituanWalletAppliedTierDoc[] = [];
  for (const tier of active) {
    const count = Math.floor((remain + 0.0001) / tier.payAmount);
    if (count <= 0) continue;
    appliedTiers.push({
      tierId: tier.id,
      ...(tier.label ? { label: tier.label } : {}),
      payAmount: tier.payAmount,
      bonusAmount: tier.bonusAmount,
      count,
    });
    remain = ROUND2(remain - tier.payAmount * count);
  }
  const bonusAmount = ROUND2(
    appliedTiers.reduce((sum, tier) => sum + tier.bonusAmount * tier.count, 0)
  );
  return {
    payAmount,
    bonusAmount,
    creditAmount: ROUND2(payAmount + bonusAmount),
    appliedTiers,
  };
}

export async function getFeituanWalletSettings(): Promise<FeituanWalletSettingsDoc> {
  const snap = await getDoc(doc(getDb(), SETTINGS_COLL, SETTINGS_ID));
  if (!snap.exists()) {
    return {
      topupTiers: [],
      paymentMethods: [],
      updatedAt: Timestamp.now(),
    };
  }
  const data = snap.data() as FeituanWalletSettingsDoc;
  return {
    ...data,
    topupTiers: cleanTiers(data.topupTiers),
    paymentMethods: cleanPaymentMethods(data.paymentMethods),
  };
}

export async function saveFeituanWalletSettings(
  actorUid: string,
  input: {
    topupTiers: FeituanWalletTopupTierDoc[];
    paymentMethods: FeituanWalletPaymentMethodDoc[];
  }
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  await setDoc(
    doc(getDb(), SETTINGS_COLL, SETTINGS_ID),
    {
      topupTiers: cleanTiers(input.topupTiers),
      paymentMethods: cleanPaymentMethods(input.paymentMethods),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    },
    { merge: true }
  );
}

export async function uploadFeituanWalletPaymentMethodImage(params: {
  actorUid: string;
  file: File;
}): Promise<string> {
  if (!(await isFeituanAdmin(params.actorUid))) throw new Error('需要饭团管理员权限');
  if (!params.file.type.startsWith('image/')) throw new Error('请上传图片文件');
  const rawExt = params.file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `feituanWalletSettings/${params.actorUid}/paymentMethods/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType =
    params.file.type && params.file.type.startsWith('image/')
      ? params.file.type
      : 'image/jpeg';
  await uploadBytes(storageRef, params.file, { contentType });
  return getDownloadURL(storageRef);
}

export async function getFeituanWalletAccount(
  userId: string
): Promise<FeituanWalletAccountRow | null> {
  const snap = await getDoc(doc(getDb(), ACCOUNTS_COLL, userId));
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as FeituanWalletAccountDoc };
}

export async function ensureFeituanWalletAccount(user: User): Promise<FeituanWalletAccountRow> {
  const identity = requirePhoneUser(user);
  const db = getDb();
  const refDoc = doc(db, ACCOUNTS_COLL, identity.uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(refDoc);
    if (snap.exists()) {
      tx.update(refDoc, {
        phoneE164: identity.phoneE164,
        phoneMasked: identity.phoneMasked,
        updatedAt: serverTimestamp(),
      });
      return;
    }
    tx.set(refDoc, {
      userId: identity.uid,
      phoneE164: identity.phoneE164,
      phoneMasked: identity.phoneMasked,
      balance: 0,
      totalPayAmount: 0,
      totalBonusAmount: 0,
      totalCreditAmount: 0,
      totalSpentAmount: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies Omit<FeituanWalletAccountDoc, 'createdAt' | 'updatedAt'> & {
      createdAt: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    });
  });
  const row = await getFeituanWalletAccount(identity.uid);
  if (!row) throw new Error('钱包账户创建失败');
  return row;
}

export async function submitFeituanWalletTopupRequest(
  user: User,
  rawPayAmount: number
): Promise<string> {
  const account = await ensureFeituanWalletAccount(user);
  if (account.data.status !== 'active') throw new Error('钱包已停用');
  const settings = await getFeituanWalletSettings();
  const preview = calculateFeituanWalletTopupPreview(rawPayAmount, settings.topupTiers);
  if (preview.payAmount <= 0) throw new Error('充值金额需大于 0');
  const refDoc = doc(collection(getDb(), REQUESTS_COLL));
  await setDoc(refDoc, {
    userId: user.uid,
    walletId: account.id,
    phoneE164: account.data.phoneE164,
    phoneMasked: account.data.phoneMasked,
    payAmount: preview.payAmount,
    bonusAmount: preview.bonusAmount,
    creditAmount: preview.creditAmount,
    appliedTiers: preview.appliedTiers,
    tierSnapshot: cleanTiers(settings.topupTiers),
    paymentScreenshots: [],
    status: 'awaiting_payment',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } satisfies Omit<FeituanWalletTopupRequestDoc, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    updatedAt: ReturnType<typeof serverTimestamp>;
  });
  return refDoc.id;
}

export async function uploadFeituanWalletPaymentImage(params: {
  userId: string;
  requestId: string;
  file: File;
}): Promise<string> {
  const rawExt = params.file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `feituanWalletPayments/${params.userId}/${params.requestId}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType =
    params.file.type && params.file.type.startsWith('image/')
      ? params.file.type
      : 'image/jpeg';
  await uploadBytes(storageRef, params.file, { contentType });
  return getDownloadURL(storageRef);
}

export async function appendFeituanWalletTopupScreenshot(
  requestId: string,
  userId: string,
  url: string,
  opts?: { md5Hash?: string; contentSha256?: string }
): Promise<void> {
  const md5 = (opts?.md5Hash ?? '').trim();
  const dupOther = md5 ? await md5DuplicateInOtherWalletTopups(requestId, md5) : false;

  const refDoc = doc(getDb(), REQUESTS_COLL, requestId);
  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(refDoc);
    if (!snap.exists()) throw new Error('充值申请不存在');
    const cur = snap.data() as FeituanWalletTopupRequestDoc;
    if (cur.userId !== userId) throw new Error('无权修改此申请');
    const eff = effectiveFeituanWalletTopupStatus(cur);
    if (eff !== 'awaiting_payment') {
      throw new Error('当前状态不可上传付款截图（待核实请等待管理员处理，或联系饭团）');
    }

    const existingShots = Array.isArray(cur.paymentScreenshots) ? cur.paymentScreenshots : [];
    const dupSameRequest =
      !!md5 &&
      existingShots.some((s) => {
        return shotMd5FromUnknown(s) === md5;
      });

    const uploadedAt = Timestamp.now();
    const uploadMs = uploadedAt.toMillis();
    const createdMs = cur.createdAt?.toMillis?.() ?? 0;

    const risk = computeWalletTopupScreenshotRiskFlags({
      md5Hex: md5,
      createdAtMillis: createdMs,
      uploadMillis: uploadMs,
      dupOtherRequests: dupOther,
      dupSameRequest,
    });

    const entryRaw: Record<string, unknown> = {
      id: globalThis.crypto.randomUUID(),
      url,
      uploadedAt,
      ...(md5 ? { md5Hash: md5 } : {}),
      ...(opts?.contentSha256 ? { contentSha256: opts.contentSha256 } : {}),
      flag: risk.flag,
    };
    if (risk.flagReason) entryRaw.flagReason = risk.flagReason;

    const entry = withDefaultScreenshotFlagIfUrl(entryRaw);
    tx.update(refDoc, {
      paymentScreenshots: [...existingShots, entry],
      status: 'pending_review',
      updatedAt: serverTimestamp(),
    });
  });
}

export async function getFeituanWalletTopupRequest(
  requestId: string
): Promise<FeituanWalletTopupRequestRow | null> {
  const snap = await getDoc(doc(getDb(), REQUESTS_COLL, requestId));
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as FeituanWalletTopupRequestDoc };
}

export async function listFeituanWalletTopupRequestsByUser(
  userId: string
): Promise<FeituanWalletTopupRequestRow[]> {
  const snap = await getDocs(
    query(collection(getDb(), REQUESTS_COLL), where('userId', '==', userId))
  );
  return sortByCreatedDesc(
    snap.docs.map((d) => ({ id: d.id, data: d.data() as FeituanWalletTopupRequestDoc }))
  );
}

export async function listFeituanWalletTopupRequests(
  opts?: { status?: FeituanWalletTopupRequestDoc['status'] }
): Promise<FeituanWalletTopupRequestRow[]> {
  const snap = await getDocs(collection(getDb(), REQUESTS_COLL));
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as FeituanWalletTopupRequestDoc,
  }));
  if (opts?.status) rows = rows.filter((row) => row.data.status === opts.status);
  return sortByCreatedDesc(rows);
}

function sortByCreatedDesc<T extends { data: { createdAt?: { toMillis?: () => number } } }>(
  rows: T[]
): T[] {
  return rows.sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

export async function listFeituanWalletLedgerByUser(
  userId: string
): Promise<FeituanWalletLedgerRow[]> {
  const snap = await getDocs(
    query(collection(getDb(), LEDGER_COLL), where('userId', '==', userId))
  );
  const rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as FeituanWalletLedgerDoc,
  }));
  rows.sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function listFeituanWalletAccounts(): Promise<FeituanWalletAccountRow[]> {
  const snap = await getDocs(collection(getDb(), ACCOUNTS_COLL));
  const rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as FeituanWalletAccountDoc,
  }));
  rows.sort((a, b) => Number(b.data.balance ?? 0) - Number(a.data.balance ?? 0));
  return rows;
}

export async function confirmFeituanWalletTopupRequest(
  requestId: string,
  actorUid: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  const db = getDb();
  const reqRef = doc(db, REQUESTS_COLL, requestId);
  await runTransaction(db, async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('充值申请不存在');
    const req = reqSnap.data() as FeituanWalletTopupRequestDoc;
    const eff = effectiveFeituanWalletTopupStatus(req);
    if (eff !== 'pending_review') {
      throw new Error('仅「待核实」且已上传凭证的充值可申请确认入账');
    }
    if (!orderHasPaymentScreenshots(req.paymentScreenshots)) {
      throw new Error('尚未上传付款截图');
    }
    const walletRef = doc(db, ACCOUNTS_COLL, req.walletId);
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) throw new Error('钱包账户不存在');
    const wallet = walletSnap.data() as FeituanWalletAccountDoc;
    if (wallet.status !== 'active') throw new Error('钱包已停用');
    if (wallet.userId !== req.userId) throw new Error('钱包账户不匹配');
    const creditAmount = ROUND2(req.creditAmount);
    const nextBalance = ROUND2(Number(wallet.balance ?? 0) + creditAmount);
    const ledgerRef = doc(collection(db, LEDGER_COLL));
    tx.update(walletRef, {
      balance: nextBalance,
      totalPayAmount: ROUND2(Number(wallet.totalPayAmount ?? 0) + Number(req.payAmount ?? 0)),
      totalBonusAmount: ROUND2(Number(wallet.totalBonusAmount ?? 0) + Number(req.bonusAmount ?? 0)),
      totalCreditAmount: ROUND2(Number(wallet.totalCreditAmount ?? 0) + creditAmount),
      updatedAt: serverTimestamp(),
    });
    const note = `饭团钱包充值：实付 RM ${ROUND2(req.payAmount).toFixed(2)}，赠送 RM ${ROUND2(req.bonusAmount).toFixed(2)}`;
    tx.set(ledgerRef, {
      userId: req.userId,
      walletId: req.walletId,
      phoneMasked: req.phoneMasked ?? wallet.phoneMasked ?? null,
      type: 'topup',
      delta: creditAmount,
      balanceAfter: nextBalance,
      payAmount: ROUND2(req.payAmount),
      bonusAmount: ROUND2(req.bonusAmount),
      creditAmount,
      topupRequestId: requestId,
      note,
      createdAt: serverTimestamp(),
    } satisfies Omit<FeituanWalletLedgerDoc, 'createdAt'> & {
      createdAt: ReturnType<typeof serverTimestamp>;
    });
    tx.update(reqRef, {
      status: 'confirmed',
      confirmedAt: serverTimestamp(),
      confirmedByUserId: actorUid,
      ledgerId: ledgerRef.id,
      updatedAt: serverTimestamp(),
    });
  });
}

/** 驳回凭证：回到待付款，清空截图（旧凭证作废），顾客需重新上传 */
export async function rejectFeituanWalletTopupProof(
  requestId: string,
  actorUid: string,
  reason?: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  const db = getDb();
  const refDoc = doc(db, REQUESTS_COLL, requestId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(refDoc);
    if (!snap.exists()) throw new Error('充值申请不存在');
    const cur = snap.data() as FeituanWalletTopupRequestDoc;
    const eff = effectiveFeituanWalletTopupStatus(cur);
    if (eff !== 'pending_review') {
      throw new Error('仅「待核实」状态可驳回凭证');
    }
    if (!orderHasPaymentScreenshots(cur.paymentScreenshots)) {
      throw new Error('当前无有效凭证');
    }
    const trimmed = (reason ?? '').trim();
    tx.update(refDoc, {
      status: 'awaiting_payment',
      paymentScreenshots: [],
      lastProofRejectedReason: trimmed || null,
      lastProofRejectedAt: serverTimestamp(),
      lastProofRejectedBy: actorUid,
      updatedAt: serverTimestamp(),
    });
  });
}

/** 终局驳回：整笔充值申请不再收款（与「驳回凭证」不同） */
export async function rejectFeituanWalletTopupRequest(
  requestId: string,
  actorUid: string,
  reason: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  await updateDoc(doc(getDb(), REQUESTS_COLL, requestId), {
    status: 'rejected',
    rejectReason: reason.trim(),
    confirmedAt: serverTimestamp(),
    confirmedByUserId: actorUid,
    updatedAt: serverTimestamp(),
  });
}

export async function planFeituanWalletPayment(
  order: OrderDoc,
  userId: string
): Promise<FeituanWalletPaymentPlan> {
  if (!userId) {
    return {
      ok: false,
      reason: 'login_required',
      balance: 0,
      payAmount: 0,
      gap: 0,
      message: '请先用手机号登录后再使用饭团钱包',
    };
  }
  const account = await getFeituanWalletAccount(userId);
  const groups = buildPaymentGroups(order);
  const payAmount = ROUND2(
    groups
      .filter((g) => g.status === 'unpaid')
      .reduce((sum, group) => sum + Number(group.subtotal ?? 0), 0)
  );
  if (payAmount <= 0) {
    return {
      ok: false,
      reason: 'no_unpaid',
      balance: account?.data.balance ?? 0,
      payAmount: 0,
      gap: 0,
      message: '当前没有待付款支付组',
    };
  }
  if (!account) {
    return {
      ok: false,
      reason: 'no_wallet',
      balance: 0,
      payAmount,
      gap: payAmount,
      message: '尚未开通饭团钱包，请先充值',
    };
  }
  const balance = ROUND2(Number(account.data.balance ?? 0));
  if (account.data.status !== 'active') {
    return {
      ok: false,
      reason: 'disabled',
      balance,
      payAmount,
      gap: payAmount,
      message: '饭团钱包已停用',
    };
  }
  if (balance + 0.0001 < payAmount) {
    return {
      ok: false,
      reason: 'insufficient',
      balance,
      payAmount,
      gap: ROUND2(payAmount - balance),
      message: `钱包余额不足，差 RM ${ROUND2(payAmount - balance).toFixed(2)}`,
    };
  }
  return { ok: true, walletId: account.id, balance, payAmount };
}

export async function applyFeituanWalletPaymentToOrder(params: {
  orderId: string;
  userId: string;
  customerKey: string;
}): Promise<{ confirmed: true; deducted: number }> {
  const db = getDb();
  const orderRef = doc(db, 'orders', params.orderId);
  const walletRef = doc(db, ACCOUNTS_COLL, params.userId);
  const ledgerRef = doc(collection(db, LEDGER_COLL));
  let deducted = 0;

  await runTransaction(db, async (tx) => {
    const [orderSnap, walletSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(walletRef),
    ]);
    if (!orderSnap.exists()) throw new Error('订单不存在');
    if (!walletSnap.exists()) throw new Error('请先充值开通饭团钱包');
    const order = orderSnap.data() as OrderDoc;
    const wallet = walletSnap.data() as FeituanWalletAccountDoc;
    if (order.channel !== 'feituan') throw new Error('仅饭团订单可用饭团钱包');
    if (order.status === 'cancelled') throw new Error('订单已取消');
    if (wallet.status !== 'active') throw new Error('钱包已停用');
    if (wallet.userId !== params.userId) throw new Error('钱包账户不匹配');
    if (order.customerUserId && order.customerUserId !== params.userId) {
      throw new Error('该订单已绑定其他手机号账户');
    }
    if (!order.customerUserId && order.customerKey !== params.customerKey) {
      throw new Error('请使用下单时的同一浏览器绑定钱包支付');
    }

    const groupsBefore = buildPaymentGroups(order);
    const unpaidGroups = groupsBefore.filter((g) => g.status === 'unpaid');
    const payAmount = ROUND2(
      unpaidGroups.reduce((sum, group) => sum + Number(group.subtotal ?? 0), 0)
    );
    if (payAmount <= 0) throw new Error('当前没有待付款支付组');
    if (ROUND2(Number(wallet.balance ?? 0)) + 0.0001 < payAmount) {
      throw new Error('钱包余额不足，请先充值');
    }

    const projectRef = doc(db, 'projects', order.projectId);
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists()) throw new Error('项目不存在');
    const project = projectSnap.data() as ProjectDoc;
    if (project.shopId !== order.shopId) throw new Error('数据不一致');

    const now = Timestamp.now();
    const autoConfirmAppendIds = new Set(
      unpaidGroups.flatMap((g) => g.appendBatchIds)
    );
    const autoConfirmInitial = unpaidGroups.some((g) => g.includesInitial);
    const hasPendingProofBefore = groupsBefore.some((g) => g.status === 'pending');
    const nextBalance = ROUND2(Number(wallet.balance ?? 0) - payAmount);
    const nextTotalSpent = ROUND2(Number(wallet.totalSpentAmount ?? 0) + payAmount);
    const scope = {
      includesInitialSegment: autoConfirmInitial,
      confirmedAppendBatchIds: [...autoConfirmAppendIds],
    };

    tx.update(walletRef, {
      balance: nextBalance,
      totalSpentAmount: nextTotalSpent,
      updatedAt: serverTimestamp(),
    });
    tx.set(ledgerRef, {
      userId: params.userId,
      walletId: params.userId,
      phoneMasked: wallet.phoneMasked ?? null,
      type: 'order_payment',
      delta: -payAmount,
      balanceAfter: nextBalance,
      orderId: params.orderId,
      orderNumber: order.orderNumber,
      orderProjectId: order.projectId,
      paymentGroupScope: scope,
      note: `订单 #${order.orderNumber} 饭团钱包抵扣`,
      createdAt: serverTimestamp(),
    } satisfies Omit<FeituanWalletLedgerDoc, 'createdAt'> & {
      createdAt: ReturnType<typeof serverTimestamp>;
    });

    const walletPayment: OrderFeituanWalletPaymentDoc = {
      walletId: params.userId,
      userId: params.userId,
      deduct: payAmount,
      ledgerId: ledgerRef.id,
      paymentGroupScope: scope,
      appliedAt: now,
    };
    const nextAppendBatches = (order.appendBatches ?? []).map((batch) =>
      batch.confirmedAt || !autoConfirmAppendIds.has(batch.id)
        ? batch
        : {
            ...batch,
            confirmedAt: now,
            confirmedByUserId: 'feituan_wallet_auto',
          }
    );
    const history = [...(order.statusHistory ?? [])];
    history.push({
      action: 'feituan_wallet_payment_applied',
      timestamp: now,
      userId: params.userId,
      note: `饭团钱包抵扣 RM ${payAmount.toFixed(2)}`,
    });
    const nextPendingAmount = ROUND2(
      Math.max(0, Number(order.pendingAmount ?? 0) - payAmount)
    );
    const nextStatus: OrderStatus =
      nextPendingAmount <= 0.0001
        ? 'confirmed'
        : hasPendingProofBefore
          ? 'pending'
          : 'partial_paid';

    let deliverySlotPatch: { deliverySlot?: OrderDoc['deliverySlot'] } = {};
    if (isProjectRecurring(project) && !hasOrderDeliverySlotLocked(order)) {
      const snapshot = resolveAndBuildDeliverySlotSnapshot(
        project,
        now.toDate()
      );
      if (!snapshot) {
        throw new Error('当前时间已超过项目截单，无法完成付款');
      }
      deliverySlotPatch = { deliverySlot: snapshot };
    }

    tx.update(orderRef, {
      customerUserId: params.userId,
      customerPhoneMasked: wallet.phoneMasked ?? null,
      appendBatches: nextAppendBatches,
      feituanWalletPaymentApplications: [
        ...(order.feituanWalletPaymentApplications ?? []),
        walletPayment,
      ],
      paidAmount: ROUND2(Number(order.paidAmount ?? 0) + payAmount),
      pendingAmount: nextPendingAmount,
      status: nextStatus,
      ...(autoConfirmInitial && !order.initialPaymentConfirmedAt
        ? { initialPaymentConfirmedAt: now }
        : {}),
      statusHistory: history,
      updatedAt: serverTimestamp(),
      ...deliverySlotPatch,
    });

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };
    tx.update(projectRef, {
      stats: {
        ...prevStats,
        confirmedRevenue: ROUND2((prevStats.confirmedRevenue ?? 0) + payAmount),
        ...(nextStatus === 'confirmed' && order.status !== 'confirmed'
          ? { confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1 }
          : {}),
        ...(autoConfirmInitial && !order.initialPaymentConfirmedAt
          ? { unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1) }
          : {}),
      },
      updatedAt: serverTimestamp(),
    });

    deducted = payAmount;
  });

  return { confirmed: true, deducted };
}
