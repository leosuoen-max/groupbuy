import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getDb, getStorageClient } from './firebase';
import { buildPaymentGroups } from './paymentGroups';
import type {
  BundleSchemeDoc,
  CardLedgerDoc,
  CardLedgerType,
  CardPurchaseRequestDoc,
  CardPurchaseRequestKind,
  CardTemplateDoc,
  CardTopupRule,
  CardType,
  CustomerCardDoc,
  CustomerCardStatus,
  OrderCardPaymentDoc,
  OrderDoc,
  OrderLineDoc,
  ProjectDoc,
  ProjectProduct,
} from '../types/firestore';

export type CardTemplateRow = { id: string; data: CardTemplateDoc };

const COLL = 'card_templates';
const CUSTOMER_CARDS_COLL = 'customer_cards';
const CARD_REQUESTS_COLL = 'card_purchase_requests';
const CARD_LEDGER_COLL = 'card_ledger';
/** 本店凭证文件哈希索引（用于跨请求识别相同截图文件） */
const CARD_PAYMENT_HASH_COLL = 'card_payment_proof_hashes';

type CardProofHashHit = {
  requestId: string;
  templateId: string;
  uploadedAt: Timestamp;
};

function cardProofHashDocId(shopId: string, sha256Hex: string): string {
  return `${shopId}__${sha256Hex}`;
}

function parseProofHashHits(raw: unknown): CardProofHashHit[] {
  if (!Array.isArray(raw)) return [];
  const out: CardProofHashHit[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const requestId = typeof o.requestId === 'string' ? o.requestId : '';
    const templateId = typeof o.templateId === 'string' ? o.templateId : '';
    let uploadedAt: Timestamp | null = null;
    const u = o.uploadedAt;
    if (u instanceof Timestamp) uploadedAt = u;
    else if (u && typeof u === 'object') {
      const x = u as { seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown };
      const sec =
        typeof x.seconds === 'number'
          ? x.seconds
          : typeof x._seconds === 'number'
            ? x._seconds
            : null;
      if (sec != null) {
        const nano =
          typeof x.nanoseconds === 'number'
            ? x.nanoseconds
            : typeof (x as { _nanoseconds?: unknown })._nanoseconds === 'number'
              ? Number((x as { _nanoseconds: unknown })._nanoseconds)
              : 0;
        uploadedAt = new Timestamp(sec, nano);
      }
    }
    if (!requestId || !uploadedAt) continue;
    out.push({ requestId, templateId, uploadedAt });
  }
  return out;
}

function isLikelySha256Hex(s: string): boolean {
  return /^[a-f0-9]{64}$/i.test(s);
}

export type CustomerCardRow = { id: string; data: CustomerCardDoc };
export type CardPurchaseRequestRow = {
  id: string;
  data: CardPurchaseRequestDoc;
};

/** pending 且已上传凭证 → 商户可「确认到账」 */
export function cardRequestNeedsMerchantConfirm(
  data: CardPurchaseRequestDoc
): boolean {
  return (
    data.status === 'pending' &&
    Array.isArray(data.paymentScreenshots) &&
    data.paymentScreenshots.length > 0
  );
}

/** pending 且未上传凭证 → 顾客尚未上传付款截图 */
export function cardRequestAwaitingCustomerProof(
  data: CardPurchaseRequestDoc
): boolean {
  return (
    data.status === 'pending' &&
    (!Array.isArray(data.paymentScreenshots) ||
      data.paymentScreenshots.length === 0)
  );
}
export type CardLedgerRow = { id: string; data: CardLedgerDoc };

function sanitizeTopupRules(rules: CardTopupRule[] | undefined): CardTopupRule[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((r) => ({
      pay: Number(r?.pay ?? 0) || 0,
      gain: Number(r?.gain ?? 0) || 0,
    }))
    .filter((r) => r.pay > 0 && r.gain > 0);
}

export type CardTemplateInput = {
  name: string;
  type: CardType;
  faceValueOrUses: number;
  salePrice: number;
  validityDays: number;
  topupRules?: CardTopupRule[];
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
};

function basicValidate(input: CardTemplateInput): void {
  if (input.type !== 'stored' && input.type !== 'pass') {
    throw new Error('卡类型不合法');
  }
  if (input.type === 'pass') {
    const name = input.name?.trim();
    if (!name) throw new Error('次卡名称不能为空');
  }
  if (!Number.isFinite(input.faceValueOrUses) || input.faceValueOrUses <= 0) {
    throw new Error(input.type === 'stored' ? '面值需大于 0' : '次数需大于 0');
  }
  if (!Number.isFinite(input.salePrice) || input.salePrice <= 0) {
    throw new Error('售价需大于 0');
  }
  if (!Number.isFinite(input.validityDays) || input.validityDays < 0) {
    throw new Error('有效期需 ≥ 0（0 表示永久）');
  }
}

/** 钱包：名称强制为"钱包"，其余卡使用前端传入的名字 */
function normalizeName(input: CardTemplateInput): string {
  if (input.type === 'stored') return '钱包';
  return input.name.trim();
}

export async function listCardTemplatesByShop(
  shopId: string,
  opts?: { includeInactive?: boolean }
): Promise<CardTemplateRow[]> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, COLL), where('shopId', '==', shopId))
  );
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as CardTemplateDoc,
  }));
  if (!opts?.includeInactive) {
    rows = rows.filter((r) => r.data.isActive !== false);
  }
  rows.sort((a, b) => {
    const sa = Number(a.data.sortOrder ?? 0);
    const sb = Number(b.data.sortOrder ?? 0);
    if (sa !== sb) return sa - sb;
    const ta = a.data.updatedAt?.toMillis?.() ?? 0;
    const tb = b.data.updatedAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function getCardTemplate(
  templateId: string
): Promise<CardTemplateRow | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, COLL, templateId));
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as CardTemplateDoc };
}

/** 同一店铺仅允许一个「钱包」模板（stored）；excludeTemplateId 用于编辑/类型切换时排除当前文档 */
async function shopHasStoredWalletTemplate(
  shopId: string,
  excludeTemplateId?: string
): Promise<boolean> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, COLL), where('shopId', '==', shopId))
  );
  for (const d of snap.docs) {
    if (excludeTemplateId && d.id === excludeTemplateId) continue;
    const docType = (d.data() as CardTemplateDoc).type;
    if (docType === 'stored') return true;
  }
  return false;
}

export async function createCardTemplate(
  shopId: string,
  ownerId: string,
  input: CardTemplateInput
): Promise<string> {
  basicValidate(input);
  const db = getDb();
  if (input.type === 'stored') {
    if (await shopHasStoredWalletTemplate(shopId)) {
      throw new Error(
        '本店已开通钱包，请在「钱包」区块点击「编辑」调整配置，无需重复开通'
      );
    }
  }
  const payload: Record<string, unknown> = {
    shopId,
    ownerId,
    name: normalizeName(input),
    type: input.type,
    faceValueOrUses: Number(input.faceValueOrUses) || 0,
    salePrice: Number(input.salePrice) || 0,
    validityDays: Number(input.validityDays) || 0,
    topupRules: sanitizeTopupRules(input.topupRules),
    isActive: input.isActive !== false,
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const desc = input.description?.trim();
  if (desc) payload.description = desc;
  const ref = await addDoc(collection(db, COLL), payload);
  return ref.id;
}

export async function updateCardTemplate(
  templateId: string,
  patch: Partial<CardTemplateInput>
): Promise<void> {
  const db = getDb();
  const ref = doc(db, COLL, templateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('卡模板不存在');
  const cur = snap.data() as CardTemplateDoc;

  const next: Record<string, unknown> = { updatedAt: serverTimestamp() };
  // 类型先收口，后面用它判断 name 规则
  const effectiveType = patch.type ?? cur.type;
  if (patch.type !== undefined) {
    if (patch.type !== 'stored' && patch.type !== 'pass') {
      throw new Error('卡类型不合法');
    }
    if (patch.type === 'stored' && cur.type !== 'stored') {
      if (await shopHasStoredWalletTemplate(cur.shopId, templateId)) {
        throw new Error('本店已有钱包模板，无法将次卡改为钱包');
      }
    }
    next.type = patch.type;
    // 类型从其它切换到 stored，名字强制为"钱包"
    if (patch.type === 'stored') {
      next.name = '钱包';
    }
  }
  if (patch.name !== undefined) {
    if (effectiveType === 'stored') {
      next.name = '钱包';
    } else {
      const v = patch.name.trim();
      if (!v) throw new Error('次卡名称不能为空');
      next.name = v;
    }
  }
  if (patch.faceValueOrUses !== undefined) {
    const v = Number(patch.faceValueOrUses) || 0;
    if (v <= 0) {
      const t = patch.type ?? cur.type;
      throw new Error(t === 'stored' ? '面值需大于 0' : '次数需大于 0');
    }
    next.faceValueOrUses = v;
  }
  if (patch.salePrice !== undefined) {
    const v = Number(patch.salePrice) || 0;
    if (v <= 0) throw new Error('售价需大于 0');
    next.salePrice = v;
  }
  if (patch.validityDays !== undefined) {
    const v = Number(patch.validityDays);
    if (!Number.isFinite(v) || v < 0) throw new Error('有效期需 ≥ 0');
    next.validityDays = v;
  }
  if (patch.topupRules !== undefined) {
    next.topupRules = sanitizeTopupRules(patch.topupRules);
  }
  if (patch.description !== undefined) {
    const v = patch.description?.trim();
    next.description = v ? v : deleteField();
  }
  if (patch.isActive !== undefined) next.isActive = !!patch.isActive;
  if (patch.sortOrder !== undefined) {
    next.sortOrder = Number(patch.sortOrder) || 0;
  }
  await updateDoc(ref, next);
}

/** 仅当未售出过任何实例时才允许硬删；否则前端应改为下架。 */
export async function deleteCardTemplate(templateId: string): Promise<void> {
  const db = getDb();
  const issued = await getDocs(
    query(
      collection(db, CUSTOMER_CARDS_COLL),
      where('templateId', '==', templateId)
    )
  );
  if (!issued.empty) {
    throw new Error('该卡已有持有用户，无法删除；请改为下架。');
  }
  await deleteDoc(doc(db, COLL, templateId));
}

export async function setCardTemplateActive(
  templateId: string,
  isActive: boolean
): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, COLL, templateId), {
    isActive,
    updatedAt: serverTimestamp(),
  });
}

/** 返回该卡是否已经被任何顾客购买过（用于"删除 vs 下架"按钮显示） */
export async function cardTemplateHasIssued(
  templateId: string
): Promise<boolean> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, CUSTOMER_CARDS_COLL),
      where('templateId', '==', templateId)
    )
  );
  return !snap.empty;
}

/* ============================== 卡支付截图上传 ============================== */

export async function uploadCardPaymentImage(params: {
  shopId: string;
  requestId: string;
  file: File;
}): Promise<string> {
  const { file } = params;
  if (!file.type.startsWith('image/')) {
    throw new Error('请上传图片文件');
  }
  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `cardPayments/${params.shopId}/${params.requestId}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType =
    file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  await uploadBytes(storageRef, file, { contentType });
  return getDownloadURL(storageRef);
}

/* ============================== 顾客购卡 / 充值 ============================== */

export type SubmitCardRequestInput = {
  shopId: string;
  templateId: string;
  /** 充值时关联到具体的卡实例 */
  customerCardId?: string;
  kind: CardPurchaseRequestKind;
  customerKey: string;
  customerName?: string;
  customerPhone?: string;
  payAmount: number;
  gainValue: number;
};

function autoExpireFlag(card: CustomerCardDoc, now: Date): CustomerCardStatus {
  if (card.status === 'expired') return 'expired';
  if (card.status === 'cancelled') return 'cancelled';
  if (card.validUntil && card.validUntil.toDate() < now) return 'expired';
  if (Number(card.remaining ?? 0) <= 0 && card.status === 'active') {
    return 'used_up';
  }
  return card.status;
}

/**
 * 检查同店铺、同模板、同顾客是否已有可用钱包（active）或待确认的购卡请求。
 * 用于"一人一钱包"约束。
 */
async function findExistingActiveWalletForCustomer(
  shopId: string,
  templateId: string,
  customerKey: string
): Promise<{
  activeCard: CustomerCardRow | null;
  pendingRequest: CardPurchaseRequestRow | null;
}> {
  const db = getDb();
  const [cardsSnap, reqSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, CUSTOMER_CARDS_COLL),
        where('shopId', '==', shopId),
        where('templateId', '==', templateId),
        where('customerKey', '==', customerKey)
      )
    ),
    getDocs(
      query(
        collection(db, CARD_REQUESTS_COLL),
        where('shopId', '==', shopId),
        where('templateId', '==', templateId),
        where('customerKey', '==', customerKey),
        where('kind', '==', 'purchase'),
        where('status', '==', 'pending')
      )
    ),
  ]);
  const now = new Date();
  const activeCard =
    cardsSnap.docs
      .map((d) => ({ id: d.id, data: d.data() as CustomerCardDoc }))
      .map((row) => ({
        id: row.id,
        data: { ...row.data, status: autoExpireFlag(row.data, now) },
      }))
      .find((row) => row.data.status === 'active') ?? null;
  const pendingRequest = reqSnap.empty
    ? null
    : ({
        id: reqSnap.docs[0]!.id,
        data: reqSnap.docs[0]!.data() as CardPurchaseRequestDoc,
      } as CardPurchaseRequestRow);
  return { activeCard, pendingRequest };
}

/** 次卡：已有实例（非已取消）或待确认首购请求时，禁止再次首购 */
async function assertCanPurchasePassTemplate(
  shopId: string,
  templateId: string,
  customerKey: string
): Promise<void> {
  const db = getDb();
  const reqSnap = await getDocs(
    query(
      collection(db, CARD_REQUESTS_COLL),
      where('shopId', '==', shopId),
      where('templateId', '==', templateId),
      where('customerKey', '==', customerKey),
      where('kind', '==', 'purchase'),
      where('status', '==', 'pending')
    )
  );
  if (!reqSnap.empty) {
    throw new Error(
      '你已有一笔待确认的购买请求，请先完成或撤销后再试'
    );
  }
  const cardsSnap = await getDocs(
    query(
      collection(db, CUSTOMER_CARDS_COLL),
      where('shopId', '==', shopId),
      where('templateId', '==', templateId),
      where('customerKey', '==', customerKey)
    )
  );
  const now = new Date();
  for (const d of cardsSnap.docs) {
    const raw = d.data() as CustomerCardDoc;
    const st = autoExpireFlag(raw, now);
    if (st !== 'cancelled') {
      throw new Error(
        '你已持有该次卡，请对该卡「充值」续次数；首购专享价仅适用于首次购买'
      );
    }
  }
}

const MONEY_EPS = 0.005;

function nearlyEqMoney(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) < MONEY_EPS;
}

function nearlyEqPassGain(a: number, b: number): boolean {
  return Math.round(Number(a)) === Math.round(Number(b));
}

function validatePurchaseAmountsAgainstTemplate(
  tpl: CardTemplateDoc,
  payAmount: number,
  gainValue: number
): void {
  const sp = Number(tpl.salePrice) || 0;
  const fv = Number(tpl.faceValueOrUses) || 0;
  if (tpl.type === 'stored') {
    if (!nearlyEqMoney(payAmount, sp) || !nearlyEqMoney(gainValue, fv)) {
      throw new Error('购卡金额与模板不符，请刷新页面后重试');
    }
  } else {
    if (!nearlyEqMoney(payAmount, sp) || !nearlyEqPassGain(gainValue, fv)) {
      throw new Error('购卡金额与模板不符，请刷新页面后重试');
    }
  }
}

function validateTopupAmountsAgainstRules(
  tpl: CardTemplateDoc,
  payAmount: number,
  gainValue: number
): void {
  const rules = sanitizeTopupRules(tpl.topupRules);
  if (rules.length === 0) {
    throw new Error('商户尚未配置充值档位，暂时无法充值');
  }
  const ok = rules.some((r) =>
    tpl.type === 'stored'
      ? nearlyEqMoney(r.pay, payAmount) && nearlyEqMoney(r.gain, gainValue)
      : nearlyEqMoney(r.pay, payAmount) && nearlyEqPassGain(r.gain, gainValue)
  );
  if (!ok) {
    throw new Error('充值档位无效，请刷新页面后重试');
  }
}

/** 顾客创建一笔购卡 / 充值请求；返回 requestId（之后追加截图、等商户确认） */
export async function submitCardPurchaseRequest(
  input: SubmitCardRequestInput
): Promise<string> {
  const tplSnap = await getDoc(doc(getDb(), COLL, input.templateId));
  if (!tplSnap.exists()) throw new Error('优惠卡模板不存在或已删除');
  const tpl = tplSnap.data() as CardTemplateDoc;
  if (tpl.shopId !== input.shopId) throw new Error('优惠卡与店铺不匹配');
  if (tpl.isActive === false) throw new Error('该优惠卡已下架，暂不可购买');
  if (input.kind === 'topup') {
    if (!input.customerCardId) throw new Error('充值需指定卡实例');
  }
  if (!Number.isFinite(input.payAmount) || input.payAmount <= 0) {
    throw new Error('实付金额需大于 0');
  }
  if (!Number.isFinite(input.gainValue) || input.gainValue <= 0) {
    throw new Error('到账值需大于 0');
  }

  // 钱包：一人一钱包约束（仅在 purchase 时检查）
  if (input.kind === 'purchase' && tpl.type === 'stored') {
    const { activeCard, pendingRequest } =
      await findExistingActiveWalletForCustomer(
        input.shopId,
        input.templateId,
        input.customerKey
      );
    if (activeCard) {
      throw new Error('你已持有此钱包，请前往「充值」续值');
    }
    if (pendingRequest) {
      throw new Error('你已有一笔待确认的购买请求，请先完成或撤销后再试');
    }
  }

  if (input.kind === 'purchase' && tpl.type === 'pass') {
    await assertCanPurchasePassTemplate(
      input.shopId,
      input.templateId,
      input.customerKey
    );
  }

  if (input.kind === 'purchase') {
    validatePurchaseAmountsAgainstTemplate(
      tpl,
      input.payAmount,
      input.gainValue
    );
  } else {
    validateTopupAmountsAgainstRules(tpl, input.payAmount, input.gainValue);
  }

  const payload: Record<string, unknown> = {
    shopId: input.shopId,
    templateId: input.templateId,
    kind: input.kind,
    customerKey: input.customerKey,
    payAmount: Number(input.payAmount) || 0,
    gainValue: Number(input.gainValue) || 0,
    paymentScreenshots: [],
    status: 'pending',
    templateNameSnapshot: tpl.name ?? '',
    templateTypeSnapshot: tpl.type,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.customerCardId) payload.customerCardId = input.customerCardId;
  if (input.customerName?.trim()) payload.customerName = input.customerName.trim();
  if (input.customerPhone?.trim()) payload.customerPhone = input.customerPhone.trim();

  const ref = await addDoc(collection(getDb(), CARD_REQUESTS_COLL), payload);
  return ref.id;
}

export async function appendCardPaymentScreenshotToRequest(
  requestId: string,
  url: string,
  opts?: { contentSha256?: string }
): Promise<void> {
  const db = getDb();
  const refDoc = doc(db, CARD_REQUESTS_COLL, requestId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(refDoc);
    if (!snap.exists()) throw new Error('请求不存在');
    const cur = snap.data() as CardPurchaseRequestDoc;
    if (cur.status !== 'pending') {
      throw new Error('该请求已不可修改');
    }

    const sha =
      typeof opts?.contentSha256 === 'string'
        ? opts.contentSha256.trim().toLowerCase()
        : '';

    const baseShot: CardPurchaseRequestDoc['paymentScreenshots'][number] = {
      url,
      uploadedAt: Timestamp.now(),
    };

    if (sha && isLikelySha256Hex(sha)) {
      const hashRef = doc(db, CARD_PAYMENT_HASH_COLL, cardProofHashDocId(cur.shopId, sha));
      const hashSnap = await tx.get(hashRef);
      const prevHits = hashSnap.exists()
        ? parseProofHashHits(hashSnap.data().hits)
        : [];
      const otherRequests = prevHits.filter((h) => h.requestId !== requestId);
      if (otherRequests.length > 0) {
        baseShot.contentSha256 = sha;
        baseShot.duplicateRisk = true;
        baseShot.duplicateMatchRequestIds = [
          ...new Set(otherRequests.map((h) => h.requestId)),
        ];
      } else {
        baseShot.contentSha256 = sha;
      }

      const nextHits: CardProofHashHit[] = [
        ...prevHits,
        {
          requestId,
          templateId: cur.templateId,
          uploadedAt: Timestamp.now(),
        },
      ];
      const capped = nextHits.slice(-120);
      tx.set(
        hashRef,
        {
          shopId: cur.shopId,
          sha256: sha,
          hits: capped,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    const nextShots = [
      ...(Array.isArray(cur.paymentScreenshots) ? cur.paymentScreenshots : []),
      baseShot,
    ];
    tx.update(refDoc, {
      paymentScreenshots: nextShots,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function removeCardPaymentScreenshotFromRequest(
  requestId: string,
  url: string
): Promise<void> {
  const refDoc = doc(getDb(), CARD_REQUESTS_COLL, requestId);
  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(refDoc);
    if (!snap.exists()) throw new Error('请求不存在');
    const cur = snap.data() as CardPurchaseRequestDoc;
    if (cur.status !== 'pending') {
      throw new Error('该请求已不可修改');
    }
    const nextShots = (Array.isArray(cur.paymentScreenshots)
      ? cur.paymentScreenshots
      : []
    ).filter((s) => s.url !== url);
    tx.update(refDoc, {
      paymentScreenshots: nextShots,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function getCardPurchaseRequest(
  requestId: string
): Promise<CardPurchaseRequestRow | null> {
  const snap = await getDoc(doc(getDb(), CARD_REQUESTS_COLL, requestId));
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as CardPurchaseRequestDoc };
}

export async function listCardRequestsByShop(
  shopId: string,
  opts?: { status?: CardPurchaseRequestDoc['status'] }
): Promise<CardPurchaseRequestRow[]> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, CARD_REQUESTS_COLL), where('shopId', '==', shopId))
  );
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as CardPurchaseRequestDoc,
  }));
  if (opts?.status) {
    rows = rows.filter((r) => r.data.status === opts.status);
  }
  rows.sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function listCardRequestsByTemplate(
  templateId: string,
  opts?: { status?: CardPurchaseRequestDoc['status'] }
): Promise<CardPurchaseRequestRow[]> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, CARD_REQUESTS_COLL),
      where('templateId', '==', templateId)
    )
  );
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as CardPurchaseRequestDoc,
  }));
  if (opts?.status) {
    rows = rows.filter((r) => r.data.status === opts.status);
  }
  rows.sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function listCardRequestsByCustomer(
  customerKey: string,
  shopId: string,
  opts?: { status?: CardPurchaseRequestDoc['status'] }
): Promise<CardPurchaseRequestRow[]> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, CARD_REQUESTS_COLL),
      where('customerKey', '==', customerKey),
      where('shopId', '==', shopId)
    )
  );
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as CardPurchaseRequestDoc,
  }));
  if (opts?.status) {
    rows = rows.filter((r) => r.data.status === opts.status);
  }
  rows.sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

/* ============================== 商户确认 / 拒绝 ============================== */

/** 商户确认一笔购卡 / 充值请求：原子化激活卡或补充次数/面值 + 写流水 */
export async function confirmCardPurchaseRequest(
  requestId: string,
  confirmedByUserId: string
): Promise<{ customerCardId: string }> {
  const db = getDb();
  const reqRef = doc(db, CARD_REQUESTS_COLL, requestId);

  // 事务前预检：防止"一人一钱包"被竞争破坏（事务内不能 query，只能这样兜底）
  const preReqSnap = await getDoc(reqRef);
  if (!preReqSnap.exists()) throw new Error('请求不存在');
  const preReq = preReqSnap.data() as CardPurchaseRequestDoc;
  if (
    preReq.status === 'pending' &&
    preReq.kind === 'purchase' &&
    preReq.templateTypeSnapshot === 'stored'
  ) {
    const { activeCard } = await findExistingActiveWalletForCustomer(
      preReq.shopId,
      preReq.templateId,
      preReq.customerKey
    );
    if (activeCard) {
      throw new Error(
        '该顾客已持有此钱包，请改为「拒绝」并提示其改用充值'
      );
    }
  }

  let resultCardId = '';

  await runTransaction(db, async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('请求不存在');
    const req = reqSnap.data() as CardPurchaseRequestDoc;
    if (req.status !== 'pending') throw new Error('该请求已被处理');
    if (
      !Array.isArray(req.paymentScreenshots) ||
      req.paymentScreenshots.length === 0
    ) {
      throw new Error('该请求尚未上传付款截图，无法确认');
    }

    const tplRef = doc(db, COLL, req.templateId);
    const tplSnap = await tx.get(tplRef);
    if (!tplSnap.exists()) throw new Error('卡模板不存在');
    const tpl = tplSnap.data() as CardTemplateDoc;

    const now = Timestamp.now();
    const validUntil =
      Number(tpl.validityDays ?? 0) > 0
        ? Timestamp.fromMillis(
            now.toMillis() + Number(tpl.validityDays) * 86400000
          )
        : null;

    if (req.kind === 'purchase') {
      const newCardRef = doc(collection(db, CUSTOMER_CARDS_COLL));
      const cardPayload: Record<string, unknown> = {
        shopId: req.shopId,
        templateId: req.templateId,
        templateNameSnapshot: req.templateNameSnapshot ?? tpl.name,
        type: req.templateTypeSnapshot ?? tpl.type,
        customerKey: req.customerKey,
        remaining: Number(req.gainValue) || 0,
        totalIn: Number(req.gainValue) || 0,
        totalOut: 0,
        status: 'active' satisfies CustomerCardStatus,
        activatedAt: now,
        validUntil,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (req.customerName) cardPayload.customerName = req.customerName;
      if (req.customerPhone) cardPayload.customerPhone = req.customerPhone;

      tx.set(newCardRef, cardPayload);

      const ledgerRef = doc(collection(db, CARD_LEDGER_COLL));
      tx.set(ledgerRef, {
        shopId: req.shopId,
        customerCardId: newCardRef.id,
        templateId: req.templateId,
        customerKey: req.customerKey,
        type: 'purchase' satisfies CardLedgerType,
        delta: Number(req.gainValue) || 0,
        remainingAfter: Number(req.gainValue) || 0,
        note: '商户确认购卡',
        createdAt: serverTimestamp(),
      });

      tx.update(reqRef, {
        status: 'confirmed',
        confirmedAt: serverTimestamp(),
        confirmedByUserId,
        customerCardId: newCardRef.id,
        updatedAt: serverTimestamp(),
      });

      resultCardId = newCardRef.id;
      return;
    }

    if (!req.customerCardId) throw new Error('充值缺少卡实例');
    const cardRef = doc(db, CUSTOMER_CARDS_COLL, req.customerCardId);
    const cardSnap = await tx.get(cardRef);
    if (!cardSnap.exists()) throw new Error('对应卡实例不存在');
    const card = cardSnap.data() as CustomerCardDoc;
    if (card.shopId !== req.shopId) throw new Error('卡实例与店铺不匹配');
    if (card.status === 'cancelled' || card.status === 'expired') {
      throw new Error('该卡已不可用，无法续值');
    }

    const newRemaining = Number(card.remaining ?? 0) + Number(req.gainValue);
    const newTotalIn = Number(card.totalIn ?? 0) + Number(req.gainValue);

    const cardPatch: Record<string, unknown> = {
      remaining: newRemaining,
      totalIn: newTotalIn,
      status: 'active' satisfies CustomerCardStatus,
      updatedAt: serverTimestamp(),
    };
    // 充值后顺延有效期：以"现有 validUntil 与当前时间的较大值"为基准 + 模板有效期
    if (Number(tpl.validityDays ?? 0) > 0) {
      const existing = card.validUntil?.toMillis?.() ?? 0;
      const base = Math.max(existing, now.toMillis());
      cardPatch.validUntil = Timestamp.fromMillis(
        base + Number(tpl.validityDays) * 86400000
      );
    }
    tx.update(cardRef, cardPatch);

    const ledgerRef = doc(collection(db, CARD_LEDGER_COLL));
    tx.set(ledgerRef, {
      shopId: req.shopId,
      customerCardId: req.customerCardId,
      templateId: req.templateId,
      customerKey: req.customerKey,
      type: 'topup' satisfies CardLedgerType,
      delta: Number(req.gainValue) || 0,
      remainingAfter: newRemaining,
      note: '商户确认充值',
      createdAt: serverTimestamp(),
    });

    tx.update(reqRef, {
      status: 'confirmed',
      confirmedAt: serverTimestamp(),
      confirmedByUserId,
      updatedAt: serverTimestamp(),
    });

    resultCardId = req.customerCardId;
  });

  return { customerCardId: resultCardId };
}

export async function rejectCardPurchaseRequest(
  requestId: string,
  reason: string,
  rejectedByUserId: string
): Promise<void> {
  const db = getDb();
  await runTransaction(db, async (tx) => {
    const refDoc = doc(db, CARD_REQUESTS_COLL, requestId);
    const snap = await tx.get(refDoc);
    if (!snap.exists()) throw new Error('请求不存在');
    const cur = snap.data() as CardPurchaseRequestDoc;
    if (cur.status !== 'pending') throw new Error('该请求已被处理');
    tx.update(refDoc, {
      status: 'rejected',
      rejectReason: reason || '',
      confirmedByUserId: rejectedByUserId,
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

/* ============================== 顾客卡 & 流水查询 ============================== */

export async function listCustomerCardsByCustomer(
  customerKey: string,
  shopId: string
): Promise<CustomerCardRow[]> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, CUSTOMER_CARDS_COLL),
      where('customerKey', '==', customerKey),
      where('shopId', '==', shopId)
    )
  );
  const now = new Date();
  const rows = snap.docs.map((d) => {
    const data = d.data() as CustomerCardDoc;
    const next = autoExpireFlag(data, now);
    return { id: d.id, data: { ...data, status: next } };
  });
  // 异步把 expired 真的同步回库（不阻塞 UI）
  for (const r of rows) {
    if (r.data.status === 'expired') {
      const original = snap.docs.find((d) => d.id === r.id);
      const orig = original?.data() as CustomerCardDoc | undefined;
      if (orig?.status !== 'expired') {
        void updateDoc(doc(db, CUSTOMER_CARDS_COLL, r.id), {
          status: 'expired',
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
    }
  }
  rows.sort((a, b) => {
    const ta = a.data.activatedAt?.toMillis?.() ?? a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.activatedAt?.toMillis?.() ?? b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function listCustomerCardsByTemplate(
  templateId: string
): Promise<CustomerCardRow[]> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, CUSTOMER_CARDS_COLL),
      where('templateId', '==', templateId)
    )
  );
  const now = new Date();
  const rows = snap.docs.map((d) => {
    const data = d.data() as CustomerCardDoc;
    const next = autoExpireFlag(data, now);
    return { id: d.id, data: { ...data, status: next } };
  });
  rows.sort((a, b) => {
    const ta = a.data.activatedAt?.toMillis?.() ?? a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.activatedAt?.toMillis?.() ?? b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function getCustomerCard(
  cardId: string
): Promise<CustomerCardRow | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, CUSTOMER_CARDS_COLL, cardId));
  if (!snap.exists()) return null;
  const data = snap.data() as CustomerCardDoc;
  return { id: snap.id, data: { ...data, status: autoExpireFlag(data, new Date()) } };
}

export async function listCardLedger(opts: {
  customerCardId?: string;
  templateId?: string;
  shopId?: string;
  limit?: number;
}): Promise<CardLedgerRow[]> {
  const db = getDb();
  const constraints = [] as ReturnType<typeof where>[];
  if (opts.customerCardId) {
    constraints.push(where('customerCardId', '==', opts.customerCardId));
  } else if (opts.templateId) {
    constraints.push(where('templateId', '==', opts.templateId));
  } else if (opts.shopId) {
    constraints.push(where('shopId', '==', opts.shopId));
  } else {
    return [];
  }
  const cap = Math.max(1, Math.min(500, Number(opts.limit ?? 200)));
  /** 单字段 equality，无需复合索引；在客户端按时间排序（Firestore 上 equality + orderBy 另一字段会触发索引错误） */
  const snap = await getDocs(
    query(collection(db, CARD_LEDGER_COLL), ...constraints)
  );
  const rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as CardLedgerDoc,
  }));
  rows.sort((a, b) => {
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows.slice(0, cap);
}

/** 顾客取消尚未确认的请求（顾客主动撤销） */
export async function cancelCardPurchaseRequest(
  requestId: string,
  customerKey: string
): Promise<void> {
  const db = getDb();
  await runTransaction(db, async (tx) => {
    const refDoc = doc(db, CARD_REQUESTS_COLL, requestId);
    const snap = await tx.get(refDoc);
    if (!snap.exists()) throw new Error('请求不存在');
    const cur = snap.data() as CardPurchaseRequestDoc;
    if (cur.customerKey !== customerKey) throw new Error('无权撤销此请求');
    if (cur.status !== 'pending') throw new Error('该请求已被处理');
    tx.update(refDoc, {
      status: 'rejected',
      rejectReason: '顾客主动撤销',
      updatedAt: serverTimestamp(),
    });
  });
}

/* ======================================================================
 *  订单结算时使用卡（钱包 + 次卡）
 * ====================================================================== */

const ROUND2 = (n: number) => Math.round(n * 100) / 100;

/** 把订单行解析成可被次卡匹配的"产品键" */
type LineKey =
  | { kind: 'product'; productId: string }
  | { kind: 'bundle'; bundleToolId: string; schemeId: string };

function parseLineKey(line: OrderLineDoc): LineKey {
  if (line.productId.startsWith('bundle:')) {
    const parts = line.productId.split(':');
    const bundleToolId = parts[1] ?? '';
    const schemeId = parts[2] ?? '';
    return { kind: 'bundle', bundleToolId, schemeId };
  }
  return { kind: 'product', productId: line.productId };
}

/** 从项目中查询某行可使用的次卡模板 id 列表 */
function resolveApplicableTemplatesForLine(
  project: ProjectDoc,
  line: OrderLineDoc
): string[] {
  const key = parseLineKey(line);
  if (key.kind === 'product') {
    const product = (project.products ?? []).find(
      (p) => p.id === key.productId
    ) as ProjectProduct | undefined;
    return Array.isArray(product?.applicableCardTemplateIds)
      ? (product?.applicableCardTemplateIds ?? [])
      : [];
  }
  const tool = (project.bundleTools ?? []).find((t) => t.id === key.bundleToolId);
  if (!tool) return [];
  const scheme = tool.schemes.find(
    (s) => s.id === key.schemeId
  ) as BundleSchemeDoc | undefined;
  return Array.isArray(
    (scheme as { applicableCardTemplateIds?: string[] } | undefined)
      ?.applicableCardTemplateIds
  )
    ? (scheme as { applicableCardTemplateIds?: string[] })
        .applicableCardTemplateIds!
    : [];
}

export type CardPaymentPlanLineAlloc = {
  /** 订单行 productId（包含 bundle: 前缀） */
  lineProductId: string;
  unitPrice: number;
  quantity: number;
  /** 命中次卡的份数 */
  passCovered: number;
};

export type CardPaymentPlanCardAlloc = {
  customerCardId: string;
  templateId: string;
  templateNameSnapshot: string;
  /** 该卡共消耗多少次 */
  uses: number;
  /** 命中的订单行 productId 列表（按消耗顺序，可重复） */
  appliedLineProductIds: string[];
};

export type CardPaymentPlan =
  | {
      ok: true;
      totalAmount: number;
      passCovered: number;
      walletDeduct: number;
      walletCardId?: string;
      walletTemplateId?: string;
      walletNameSnapshot?: string;
      lineAllocations: CardPaymentPlanLineAlloc[];
      cardAllocations: CardPaymentPlanCardAlloc[];
      summary: {
        passUseCount: number;
        walletUsed: number;
        cardsCount: number;
      };
    }
  | {
      ok: false;
      reason: 'insufficient' | 'no_cards';
      totalAmount: number;
      passCovered: number;
      walletAvailable: number;
      gap: number;
      message: string;
    };

/** 计算挑卡 + 钱包抵扣方案，不写库 */
export async function planCardPayment(
  order: OrderDoc,
  project: ProjectDoc,
  customerKey: string
): Promise<CardPaymentPlan> {
  const groups = buildPaymentGroups(order);
  const unpaidGroups = groups.filter((g) => g.status === 'unpaid');
  const unpaidTotal = ROUND2(
    unpaidGroups.reduce((s, g) => s + (Number(g.subtotal) || 0), 0)
  );
  const requestedAmount = ROUND2(
    Math.max(0, Math.min(unpaidTotal, Number(order.totalAmount ?? 0)))
  );
  // 1. 拉取本店该顾客所有 active 卡
  const cards = (
    await listCustomerCardsByCustomer(customerKey, order.shopId)
  ).filter((c) => c.data.status === 'active' && Number(c.data.remaining ?? 0) > 0);
  const passCards = cards.filter((c) => c.data.type === 'pass');
  const wallet = cards.find((c) => c.data.type === 'stored') ?? null;

  // 2. 仅针对“待付款支付组”计算可抵扣行（不覆盖待确认组）
  const lines = unpaidGroups.flatMap((g) => g.lines as OrderLineDoc[]);
  const totalAmount = ROUND2(
    Math.max(
      0,
      Math.min(
        requestedAmount,
        lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0)
      )
    )
  );
  const lineMeta = lines.map((l) => ({
    line: l,
    applicableTemplateIds: resolveApplicableTemplatesForLine(project, l),
    coveredQuantity: 0,
  }));

  // 3. 评估每张次卡的"可用范围广度"——本订单中能匹配的不同 productId 数
  const cardScopeBreadth = new Map<string, number>();
  for (const c of passCards) {
    let breadth = 0;
    const seen = new Set<string>();
    for (const m of lineMeta) {
      if (seen.has(m.line.productId)) continue;
      if (m.applicableTemplateIds.includes(c.data.templateId)) {
        seen.add(m.line.productId);
        breadth += 1;
      }
    }
    cardScopeBreadth.set(c.id, breadth);
  }

  // 4. 排序：广度升序 → 到期升序 → 剩余次数升序
  const sortedPass = [...passCards].sort((a, b) => {
    const ba = cardScopeBreadth.get(a.id) ?? 0;
    const bb = cardScopeBreadth.get(b.id) ?? 0;
    if (ba !== bb) return ba - bb;
    const ea = a.data.validUntil?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    const eb = b.data.validUntil?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    if (ea !== eb) return ea - eb;
    return Number(a.data.remaining ?? 0) - Number(b.data.remaining ?? 0);
  });

  // 5. 贪婪分配：每张卡逐次抵扣命中行
  const cardUses = new Map<
    string,
    { card: CustomerCardRow; uses: number; appliedLineProductIds: string[] }
  >();

  for (const card of sortedPass) {
    let remaining = Number(card.data.remaining ?? 0);
    const tplId = card.data.templateId;
    while (remaining > 0) {
      const target = lineMeta.find(
        (m) =>
          m.coveredQuantity < m.line.quantity &&
          m.applicableTemplateIds.includes(tplId)
      );
      if (!target) break;
      target.coveredQuantity += 1;
      remaining -= 1;

      const key = card.id;
      const cur = cardUses.get(key) ?? {
        card,
        uses: 0,
        appliedLineProductIds: [] as string[],
      };
      cur.uses += 1;
      cur.appliedLineProductIds.push(target.line.productId);
      cardUses.set(key, cur);
    }
  }

  const passCovered = ROUND2(
    lineMeta.reduce(
      (acc, m) => acc + m.coveredQuantity * Number(m.line.unitPrice ?? 0),
      0
    )
  );

  const remainingAmount = ROUND2(totalAmount - passCovered);
  const walletAvailable = ROUND2(Number(wallet?.data.remaining ?? 0));

  if (remainingAmount > walletAvailable + 0.0001) {
    const gap = ROUND2(remainingAmount - walletAvailable);
    return {
      ok: false,
      reason: passCards.length === 0 && !wallet ? 'no_cards' : 'insufficient',
      totalAmount,
      passCovered,
      walletAvailable,
      gap,
      message:
        passCards.length === 0 && !wallet
          ? '尚未持有可用的钱包/次卡，请先购买或充值'
          : `卡余额不足，差 RM ${gap.toFixed(2)}`,
    };
  }

  const lineAllocations: CardPaymentPlanLineAlloc[] = lineMeta.map((m) => ({
    lineProductId: m.line.productId,
    unitPrice: Number(m.line.unitPrice ?? 0),
    quantity: Number(m.line.quantity ?? 0),
    passCovered: m.coveredQuantity,
  }));

  const cardAllocations: CardPaymentPlanCardAlloc[] = Array.from(
    cardUses.values()
  ).map((u) => ({
    customerCardId: u.card.id,
    templateId: u.card.data.templateId,
    templateNameSnapshot: u.card.data.templateNameSnapshot,
    uses: u.uses,
    appliedLineProductIds: u.appliedLineProductIds,
  }));

  const walletDeduct = ROUND2(remainingAmount);

  return {
    ok: true,
    totalAmount,
    passCovered,
    walletDeduct,
    walletCardId: walletDeduct > 0 ? wallet?.id : undefined,
    walletTemplateId: walletDeduct > 0 ? wallet?.data.templateId : undefined,
    walletNameSnapshot:
      walletDeduct > 0 ? wallet?.data.templateNameSnapshot : undefined,
    lineAllocations,
    cardAllocations,
    summary: {
      passUseCount: cardAllocations.reduce((acc, a) => acc + a.uses, 0),
      walletUsed: walletDeduct,
      cardsCount:
        cardAllocations.length + (walletDeduct > 0 && wallet ? 1 : 0),
    },
  };
}

/**
 * 原子事务执行：扣卡 + 写流水 + 更新订单为已确认
 * - 入参：订单文档路径（projectId + orderId）+ customerKey
 * - 内部重新拉取订单与项目 → 复算 plan → 在事务里逐张校验余额并执行
 */
export async function applyCardPaymentToOrder(params: {
  projectId: string;
  orderId: string;
  customerKey: string;
}): Promise<{ confirmed: true; deducted: number }> {
  const db = getDb();
  const orderRef = doc(db, 'orders', params.orderId);
  const projectRef = doc(db, 'projects', params.projectId);

  // 事务前预取一次（计算 plan + 提前给出错误信息）
  const [orderSnapPre, projectSnapPre] = await Promise.all([
    getDoc(orderRef),
    getDoc(projectRef),
  ]);
  if (!orderSnapPre.exists()) throw new Error('订单不存在');
  if (!projectSnapPre.exists()) throw new Error('项目不存在');
  const orderPre = orderSnapPre.data() as OrderDoc;
  const projectPre = projectSnapPre.data() as ProjectDoc;
  if (orderPre.customerKey !== params.customerKey) {
    throw new Error('无权操作他人订单');
  }
  if (orderPre.status === 'cancelled') {
    throw new Error('订单已取消');
  }
  if (orderPre.status === 'confirmed') {
    throw new Error('订单已确认，无需再次支付');
  }
  if (Number(orderPre.pendingAmount ?? 0) <= 0) {
    throw new Error('订单已无未付金额');
  }
  const plan = await planCardPayment(orderPre, projectPre, params.customerKey);
  if (!plan.ok) {
    const failedPlan = plan as Extract<CardPaymentPlan, { ok: false }>;
    throw new Error(failedPlan.message);
  }

  // 准备事务里要 get 的所有 doc
  const cardRefs = plan.cardAllocations.map((a) =>
    doc(db, CUSTOMER_CARDS_COLL, a.customerCardId)
  );
  const walletRef = plan.walletCardId
    ? doc(db, CUSTOMER_CARDS_COLL, plan.walletCardId)
    : null;
  const ledgerCardRefs = plan.cardAllocations.map(() =>
    doc(collection(db, CARD_LEDGER_COLL))
  );
  const ledgerWalletRef = walletRef
    ? doc(collection(db, CARD_LEDGER_COLL))
    : null;

  await runTransaction(db, async (tx) => {
    // 1. 重新读取订单 → 状态校验
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const order = oSnap.data() as OrderDoc;
    if (order.status === 'cancelled') throw new Error('订单已取消');
    if (order.status === 'confirmed') throw new Error('订单已确认');
    if (Number(order.pendingAmount ?? 0) <= 0)
      throw new Error('订单已无未付金额');

    // 2. 读卡 + 读钱包
    const cardSnaps = await Promise.all(cardRefs.map((r) => tx.get(r)));
    const walletSnap = walletRef ? await tx.get(walletRef) : null;

    // 3. 校验余额是否仍然足够
    for (let i = 0; i < plan.cardAllocations.length; i++) {
      const a = plan.cardAllocations[i]!;
      const snap = cardSnaps[i]!;
      if (!snap.exists()) throw new Error('卡已失效，请刷新');
      const card = snap.data() as CustomerCardDoc;
      if (card.shopId !== order.shopId) throw new Error('卡与店铺不匹配');
      if (card.customerKey !== params.customerKey)
        throw new Error('无权使用他人卡');
      if (card.status !== 'active') throw new Error('卡状态异常，请刷新');
      if (Number(card.remaining ?? 0) < a.uses) {
        throw new Error('卡次数不足，请刷新页面');
      }
    }
    if (walletSnap && plan.walletDeduct > 0) {
      if (!walletSnap.exists()) throw new Error('钱包不存在，请刷新');
      const w = walletSnap.data() as CustomerCardDoc;
      if (w.shopId !== order.shopId) throw new Error('钱包与店铺不匹配');
      if (w.customerKey !== params.customerKey)
        throw new Error('无权使用他人钱包');
      if (w.status !== 'active') throw new Error('钱包不可用');
      if (ROUND2(Number(w.remaining ?? 0)) + 0.0001 < plan.walletDeduct) {
        throw new Error('钱包余额不足，请刷新');
      }
    }

    const now = Timestamp.now();

    // 4. 扣卡 + 写次卡流水
    const passCardLedgerRefs: string[] = [];
    for (let i = 0; i < plan.cardAllocations.length; i++) {
      const a = plan.cardAllocations[i]!;
      const cardRef = cardRefs[i]!;
      const cardData = cardSnaps[i]!.data() as CustomerCardDoc;
      const newRemaining = Number(cardData.remaining ?? 0) - a.uses;
      const newOut = Number(cardData.totalOut ?? 0) + a.uses;
      const nextStatus: CustomerCardStatus =
        newRemaining <= 0 ? 'used_up' : 'active';
      tx.update(cardRef, {
        remaining: newRemaining,
        totalOut: newOut,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      const ledgerRef = ledgerCardRefs[i]!;
      tx.set(ledgerRef, {
        shopId: order.shopId,
        customerCardId: a.customerCardId,
        templateId: a.templateId,
        customerKey: params.customerKey,
        type: 'use' satisfies CardLedgerType,
        delta: -a.uses,
        remainingAfter: newRemaining,
        orderId: params.orderId,
        orderNumber: order.orderNumber,
        orderProjectId: params.projectId,
        orderShopSlug: order.shopSlug,
        orderLineIds: a.appliedLineProductIds,
        note: `订单 #${order.orderNumber} 抵扣`,
        createdAt: serverTimestamp(),
      });
      passCardLedgerRefs.push(ledgerRef.id);
    }

    // 5. 钱包扣减 + 流水
    let walletLedgerId: string | undefined;
    if (walletRef && plan.walletDeduct > 0 && walletSnap?.exists()) {
      const w = walletSnap.data() as CustomerCardDoc;
      const newRemaining = ROUND2(
        Number(w.remaining ?? 0) - plan.walletDeduct
      );
      const newOut = ROUND2(Number(w.totalOut ?? 0) + plan.walletDeduct);
      const nextStatus: CustomerCardStatus =
        newRemaining <= 0 ? 'used_up' : 'active';
      tx.update(walletRef, {
        remaining: newRemaining,
        totalOut: newOut,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      const ledgerRef = ledgerWalletRef!;
      tx.set(ledgerRef, {
        shopId: order.shopId,
        customerCardId: plan.walletCardId!,
        templateId: plan.walletTemplateId!,
        customerKey: params.customerKey,
        type: 'use' satisfies CardLedgerType,
        delta: -plan.walletDeduct,
        remainingAfter: newRemaining,
        orderId: params.orderId,
        orderNumber: order.orderNumber,
        orderProjectId: params.projectId,
        orderShopSlug: order.shopSlug,
        note: `订单 #${order.orderNumber} 抵扣`,
        createdAt: serverTimestamp(),
      });
      walletLedgerId = ledgerRef.id;
    }

    // 6. 更新订单：line.cardCoveredQuantity + cardPayment + 状态/金额
    const groupsBefore = buildPaymentGroups(order);
    const unpaidGroups = groupsBefore.filter((g) => g.status === 'unpaid');
    const autoConfirmAppendIds = new Set(
      unpaidGroups.flatMap((g) => g.appendBatchIds)
    );
    const autoConfirmInitial = unpaidGroups.some((g) => g.includesInitial);
    const hasPendingProofBefore = groupsBefore.some((g) => g.status === 'pending');
    const allocByPid = new Map<string, number>();
    for (const a of plan.lineAllocations) {
      allocByPid.set(a.lineProductId, a.passCovered);
    }
    const nextLines = (order.lines ?? []).map((l) => {
      const covered = allocByPid.get(l.productId) ?? 0;
      const next: OrderLineDoc = {
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        isDiscount: l.isDiscount,
        ...(l.discountEndsAt ? { discountEndsAt: l.discountEndsAt } : {}),
        subtotal: l.subtotal,
        ...(covered > 0 ? { cardCoveredQuantity: covered } : {}),
      };
      return next;
    });

    const cardPaymentDoc: OrderCardPaymentDoc = {
      passCards: plan.cardAllocations.map((a, i) => ({
        customerCardId: a.customerCardId,
        templateId: a.templateId,
        uses: a.uses,
        appliedLineProductIds: a.appliedLineProductIds,
        ledgerId: passCardLedgerRefs[i]!,
      })),
      ...(plan.walletDeduct > 0 && walletLedgerId
        ? {
            wallet: {
              customerCardId: plan.walletCardId!,
              templateId: plan.walletTemplateId!,
              deduct: plan.walletDeduct,
              ledgerId: walletLedgerId,
            },
          }
        : {}),
      totalDeducted: ROUND2(plan.totalAmount),
      appliedAt: now,
    };

    // 卡支付是自动确认：仅把本次卡支付覆盖到的「待付款组」标记为已确认。
    const nextAppendBatches = (order.appendBatches ?? []).map((b) =>
      b.confirmedAt || !autoConfirmAppendIds.has(b.id)
        ? b
        : {
            ...b,
            confirmedAt: now,
            confirmedByUserId: 'customer_card_auto',
          }
    );

    const hist = [...(order.statusHistory ?? [])];
    hist.push({
      action: 'card_payment_applied',
      timestamp: now,
      note: `卡支付：钱包 RM ${plan.walletDeduct.toFixed(2)} + 次卡 ${plan.summary.passUseCount} 次`,
    });

    const nextPendingAmount = ROUND2(
      Math.max(0, Number(order.pendingAmount ?? 0) - plan.totalAmount)
    );
    const nextStatus: OrderDoc['status'] =
      nextPendingAmount <= 0.0001
        ? 'confirmed'
        : hasPendingProofBefore
          ? 'pending'
          : 'partial_paid';

    tx.update(orderRef, {
      lines: nextLines,
      appendBatches: nextAppendBatches,
      cardPayment: cardPaymentDoc,
      paidAmount: ROUND2(Number(order.paidAmount ?? 0) + plan.totalAmount),
      pendingAmount: nextPendingAmount,
      status: nextStatus,
      ...(autoConfirmInitial && !order.initialPaymentConfirmedAt
        ? { initialPaymentConfirmedAt: now }
        : {}),
      statusHistory: hist,
      updatedAt: serverTimestamp(),
    });

    // 7. 项目统计：unpaid - 1, confirmed + 1, confirmedRevenue +
    const stats = projectPre.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };
    const wasUnpaid = order.status === 'unpaid';
    const wasPending = order.status === 'pending' || order.status === 'partial_paid';
    const becomesConfirmed = nextStatus === 'confirmed';
    const confirmedInc = becomesConfirmed ? 1 : 0;
    const nextStats = {
      ...stats,
      unpaidOrders: Math.max(0, (stats.unpaidOrders ?? 0) - (wasUnpaid ? 1 : 0)),
      pendingOrders: Math.max(
        0,
        (stats.pendingOrders ?? 0) - (wasPending ? 1 : 0)
      ),
      confirmedOrders: (stats.confirmedOrders ?? 0) + confirmedInc,
      confirmedRevenue:
        ROUND2(Number(stats.confirmedRevenue ?? 0)) +
        ROUND2(plan.totalAmount),
    };
    tx.update(projectRef, {
      stats: nextStats,
      updatedAt: serverTimestamp(),
    });
  });

  return { confirmed: true, deducted: plan.totalAmount };
}
