import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getDb, getStorageClient } from './firebase';
import type {
  CardLedgerDoc,
  CardLedgerType,
  CardPurchaseRequestDoc,
  CardPurchaseRequestKind,
  CardTemplateDoc,
  CardTopupRule,
  CardType,
  CustomerCardDoc,
  CustomerCardStatus,
} from '../types/firestore';

export type CardTemplateRow = { id: string; data: CardTemplateDoc };

const COLL = 'card_templates';
const CUSTOMER_CARDS_COLL = 'customer_cards';
const CARD_REQUESTS_COLL = 'card_purchase_requests';
const CARD_LEDGER_COLL = 'card_ledger';

export type CustomerCardRow = { id: string; data: CustomerCardDoc };
export type CardPurchaseRequestRow = {
  id: string;
  data: CardPurchaseRequestDoc;
};
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

function sanitizeScope(
  type: CardType,
  scope: CardTemplateDoc['scope'] | undefined
): CardTemplateDoc['scope'] | undefined {
  if (type !== 'pass') return undefined;
  if (!scope) return { productIds: [], bundleSchemeIds: [] };
  return {
    productIds: Array.isArray(scope.productIds)
      ? scope.productIds.filter((x): x is string => typeof x === 'string' && !!x)
      : [],
    bundleSchemeIds: Array.isArray(scope.bundleSchemeIds)
      ? scope.bundleSchemeIds.filter((x): x is string => typeof x === 'string' && !!x)
      : [],
  };
}

export type CardTemplateInput = {
  name: string;
  type: CardType;
  faceValueOrUses: number;
  salePrice: number;
  validityDays: number;
  topupRules?: CardTopupRule[];
  scope?: CardTemplateDoc['scope'];
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

export async function createCardTemplate(
  shopId: string,
  ownerId: string,
  input: CardTemplateInput
): Promise<string> {
  basicValidate(input);
  const db = getDb();
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
  const scope = sanitizeScope(input.type, input.scope);
  if (scope) payload.scope = scope;
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
  if (patch.scope !== undefined) {
    const t = patch.type ?? cur.type;
    const s = sanitizeScope(t, patch.scope);
    next.scope = s ?? deleteField();
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
    const nextShots = [
      ...(Array.isArray(cur.paymentScreenshots) ? cur.paymentScreenshots : []),
      { url, uploadedAt: Timestamp.now() },
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

function autoExpireFlag(card: CustomerCardDoc, now: Date): CustomerCardStatus {
  if (card.status === 'expired') return 'expired';
  if (card.status === 'cancelled') return 'cancelled';
  if (card.validUntil && card.validUntil.toDate() < now) return 'expired';
  if (Number(card.remaining ?? 0) <= 0 && card.status === 'active') {
    return 'used_up';
  }
  return card.status;
}

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
  let rows = snap.docs.map((d) => {
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
  const snap = await getDocs(
    query(
      collection(db, CARD_LEDGER_COLL),
      ...constraints,
      orderBy('createdAt', 'desc'),
      fsLimit(cap)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as CardLedgerDoc }));
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
