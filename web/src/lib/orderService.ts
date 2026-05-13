import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { compressImageFileForUpload } from './imageCompress';
import {
  appendBatchHasCustomerUpload,
  canMerchantConfirmAppendBatchByScreenshots,
  canMerchantConfirmPendingAppendLump,
  orderHasPaymentScreenshots,
  withDefaultScreenshotFlagIfUrl,
} from './paymentScreenshotHelpers';
import { buildPaymentGroups } from './paymentGroups';
import {
  computeImageFileMd5Hex,
  deleteFileByDownloadUrl,
  uploadOrderPaymentImage,
} from './paymentImageUpload';
import { listDeliveryPointsByOwnerId } from './deliveryPointService';
import { isFeituanAdmin } from './feituanService';
import { getProject } from './projectService';
import { getProjectPermissionForUser } from './permissionService';
import { getShopById } from './shopService';
import type { BundleSelectionDraft, OrderLine } from '../types/orderDraft';
import type {
  BundleToolDoc,
  OrderAppendBatchDoc,
  OrderDoc,
  OrderLineDoc,
  OrderStatus,
  ProjectDoc,
  OrderChannel,
} from '../types/firestore';
import { isBundleToolPastScheduledOff, isProductPastScheduledOff } from './productAvailability';

export type OrderRow = { id: string; data: OrderDoc };
const TIMED_PROMO_PAYMENT_WINDOW_MINUTES = 30;

type OrdersCacheEntry = {
  at: number;
  rows: OrderRow[];
  pending?: Promise<OrderRow[]>;
};

/** 订单列表短时缓存：降低后台多个页面频繁来回时的重复读。 */
const ORDERS_CACHE_TTL_MS = 5000;
const shopOrdersCache = new Map<string, OrdersCacheEntry>();
const customerOrdersCache = new Map<string, OrdersCacheEntry>();

export type CreateOrderInput = {
  shopSlug: string;
  projectId: string;
  channel?: OrderChannel;
  customerKey: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNote?: string;
  deliveryPointId?: string;
  deliveryPointLabel: string;
  /** 非「其他」时常用于写入结构化快照（名称 + 详情） */
  deliverySnapshot?: { name: string; detail?: string };
  isManualMatch: boolean;
  lines: OrderLine[];
  bundleSelections?: BundleSelectionDraft[];
};

type CreateOrderErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_NOT_PUBLISHED'
  | 'PROJECT_CLOSED'
  | 'FEITUAN_ONLY'
  | 'FEITUAN_NOT_LISTED'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_INACTIVE'
  | 'INSUFFICIENT_STOCK';

const CREATE_ORDER_ERROR_MESSAGE: Record<CreateOrderErrorCode, string> = {
  PROJECT_NOT_FOUND: '项目不存在或已删除。',
  PROJECT_NOT_PUBLISHED: '项目尚未发布，暂不能下单。',
  PROJECT_CLOSED: '项目已截止，暂不能下单。',
  FEITUAN_ONLY: '该项目已在大马饭团上架，请从饭团入口参团。',
  FEITUAN_NOT_LISTED: '该项目尚未在大马饭团上架，暂不能从饭团入口下单。',
  PRODUCT_NOT_FOUND: '商品不存在，请返回重选。',
  PRODUCT_INACTIVE: '有商品已下架，请返回重选。',
  INSUFFICIENT_STOCK: '库存不足，请返回重选。',
};

export class CreateOrderError extends Error {
  code: CreateOrderErrorCode;

  constructor(code: CreateOrderErrorCode) {
    super(CREATE_ORDER_ERROR_MESSAGE[code]);
    this.code = code;
  }
}

function toOrderLines(lines: OrderLine[]): OrderLineDoc[] {
  return lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    isDiscount: l.isDiscount,
    ...(l.discountEndsAt ? { discountEndsAt: l.discountEndsAt } : {}),
    subtotal: l.quantity * l.unitPrice,
  }));
}

function computeTotal(lines: OrderLineDoc[]): number {
  return lines.reduce((sum, l) => sum + l.subtotal, 0);
}

function hasTimedPromoLine(lines: OrderLineDoc[]): boolean {
  return lines.some((l) => typeof l.discountEndsAt === 'string' && l.discountEndsAt.trim());
}

function isTimedPromoPaymentExpired(order: OrderDoc): boolean {
  if (order.status !== 'unpaid') return false;
  if ((Number(order.paidAmount) || 0) > 0) return false;
  const due = order.timedPromoPaymentDueAt;
  const dueMs = due?.toMillis?.();
  if (!dueMs) return false;
  return Date.now() > dueMs;
}

async function autoCancelExpiredTimedPromoOrder(
  orderRef: ReturnType<typeof doc>,
  order: OrderDoc
): Promise<OrderDoc> {
  const next = buildAutoCancelledTimedPromoOrder(order);
  if (!next) return order;
  await updateDoc(orderRef, {
    status: 'cancelled' as const,
    statusHistory: next.statusHistory ?? [],
    updatedAt: serverTimestamp(),
  });
  return next;
}

function buildAutoCancelledTimedPromoOrder(order: OrderDoc): OrderDoc | null {
  if (!isTimedPromoPaymentExpired(order)) return null;
  const hist = [...(order.statusHistory ?? [])];
  hist.push({
    action: 'auto_cancel_unpaid_timed_promo_expired',
    timestamp: Timestamp.now(),
    note: `限时优惠订单超过${TIMED_PROMO_PAYMENT_WINDOW_MINUTES}分钟未付款`,
  });
  return {
    ...order,
    status: 'cancelled',
    statusHistory: hist,
    updatedAt: Timestamp.now(),
  };
}

function ensureProjectCanOrder(project: ProjectDoc): void {
  if (project.status === 'draft') throw new CreateOrderError('PROJECT_NOT_PUBLISHED');
  const closesAt = project.closesAt?.toDate?.();
  if (project.status === 'closed') throw new CreateOrderError('PROJECT_CLOSED');
  if (closesAt && closesAt.getTime() <= Date.now()) {
    throw new CreateOrderError('PROJECT_CLOSED');
  }
}

/** 顾客改单/加菜：项目须仍在接单期内（与下单截止规则一致） */
export function ensureProjectAllowsCustomerEdit(project: ProjectDoc): void {
  if (project.status === 'draft') throw new Error('项目尚未发布');
  if (project.status === 'closed') throw new Error('项目已关闭，无法修改订单');
  const closesAt = project.closesAt?.toDate?.();
  if (closesAt && closesAt.getTime() <= Date.now()) {
    throw new Error('已超过截止时间，无法修改订单');
  }
}

function applyStockDeduction(project: ProjectDoc, lines: OrderLine[]): ProjectDoc['products'] {
  const nextProducts = [...(project.products ?? [])].map((p) => ({ ...p }));
  for (const line of lines) {
    const idx = nextProducts.findIndex((p) => p.id === line.productId);
    if (idx < 0) throw new CreateOrderError('PRODUCT_NOT_FOUND');
    const product = nextProducts[idx];
    if (!product.isActive || isProductPastScheduledOff(product)) {
      throw new CreateOrderError('PRODUCT_INACTIVE');
    }
    if (product.stock < line.quantity) throw new CreateOrderError('INSUFFICIENT_STOCK');
    product.stock -= line.quantity;
  }
  return nextProducts;
}

function applyBundleStockDeduction(
  project: ProjectDoc,
  selections: BundleSelectionDraft[] | undefined
): BundleToolDoc[] {
  const tools = (project.bundleTools ?? []).map((t) => ({
    ...t,
    series: t.series.map((s) => ({
      ...s,
      options: s.options.map((o) => ({ ...o })),
    })),
    schemes: t.schemes.map((x) => ({ ...x })),
  }));
  if (!selections?.length) return tools;

  for (const sel of selections) {
    const qty = Math.max(1, Math.floor(sel.quantity || 1));
    const tool = tools.find((t) => t.id === sel.bundleToolId);
    if (!tool || !tool.isActive || isBundleToolPastScheduledOff(tool)) {
      throw new Error('套餐已下架或不可用，请刷新后重试');
    }
    const scheme = tool.schemes.find((s) => s.id === sel.schemeId && s.isActive);
    if (!scheme) throw new Error('套餐方案不可用，请刷新后重试');

    for (const series of tool.series) {
      const required = Number(scheme.requirements?.[series.id] ?? 0);
      const picked = sel.selectedOptionIdsBySeries?.[series.id] ?? [];
      if (picked.length !== required) {
        throw new Error(`套餐选择不完整（${series.name} 需选 ${required} 项）`);
      }
      const uniq = new Set(picked);
      if (uniq.size !== picked.length) {
        throw new Error(`同系列不可重复选择（${series.name}）`);
      }
      for (const optId of picked) {
        const opt = series.options.find((x) => x.id === optId);
        if (!opt || !opt.isActive) throw new Error(`套餐选项不可用（${series.name}）`);
        if ((opt.stock ?? 0) < qty) {
          throw new Error(`库存不足：${series.name} - ${opt.name}`);
        }
      }
    }

    for (const series of tool.series) {
      const picked = sel.selectedOptionIdsBySeries?.[series.id] ?? [];
      for (const optId of picked) {
        const opt = series.options.find((x) => x.id === optId)!;
        opt.stock -= qty;
      }
    }
  }
  return tools;
}

export async function createOrder(input: CreateOrderInput): Promise<{ orderId: string; orderNumber: string; timedPromoPaymentDueAt?: string }> {
  const db = getDb();
  const orderRef = doc(collection(db, 'orders'));
  const projectRef = doc(db, 'projects', input.projectId);

  return runTransaction(db, async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists()) throw new CreateOrderError('PROJECT_NOT_FOUND');
    const project = projectSnap.data() as ProjectDoc;

    ensureProjectCanOrder(project);
    const channel = input.channel ?? 'shop';
    if (project.feituanStatus === 'listed' && channel !== 'feituan') {
      throw new CreateOrderError('FEITUAN_ONLY');
    }
    if (channel === 'feituan' && project.feituanStatus !== 'listed') {
      throw new CreateOrderError('FEITUAN_NOT_LISTED');
    }

    const lines = toOrderLines(input.lines);
    const normalLines = input.lines.filter((l) => !l.productId.startsWith('bundle:'));
    const nextProducts = applyStockDeduction(project, normalLines);
    const nextBundleTools = applyBundleStockDeduction(project, input.bundleSelections);
    const totalAmount = computeTotal(lines);
    const timedPromoDueAt = hasTimedPromoLine(lines)
      ? Timestamp.fromMillis(
          Date.now() + TIMED_PROMO_PAYMENT_WINDOW_MINUTES * 60 * 1000
        )
      : null;

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };
    const nextTotalOrders = (prevStats.totalOrders ?? 0) + 1;
    const orderNumber = `L${nextTotalOrders}`;
    const status: OrderStatus = 'unpaid';

    const snapshotName =
      input.deliverySnapshot?.name?.trim() ||
      input.deliveryPointLabel.trim();
    const snapshotDetail = input.deliverySnapshot?.detail?.trim();

    const orderPayload: Omit<OrderDoc, 'createdAt' | 'updatedAt'> = {
      orderNumber,
      channel,
      shopId: project.shopId,
      shopSlug: input.shopSlug,
      projectId: input.projectId,
      projectTitle: project.title,
      customerKey: input.customerKey,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      lines,
      initialLines: lines,
      initialTotalAmount: totalAmount,
      appendBatches: [],
      totalAmount,
      paidAmount: 0,
      pendingAmount: totalAmount,
      timedPromoPaymentDueAt: timedPromoDueAt,
      timedPromoWindowMinutes: timedPromoDueAt
        ? TIMED_PROMO_PAYMENT_WINDOW_MINUTES
        : null,
      deliveryPointSnapshot: {
        name: snapshotName,
        ...(snapshotDetail ? { detail: snapshotDetail } : {}),
      },
      isManualMatch: input.isManualMatch,
      paymentScreenshots: [],
      status,
      internalNotes: [],
      statusHistory: [],
    };
    if (input.customerNote) {
      orderPayload.customerNote = input.customerNote;
    }
    if (input.deliveryPointId) {
      orderPayload.deliveryPointId = input.deliveryPointId;
    }

    tx.set(orderRef, {
      ...orderPayload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      products: nextProducts,
      bundleTools: nextBundleTools,
      stats: {
        ...prevStats,
        totalOrders: nextTotalOrders,
        unpaidOrders: (prevStats.unpaidOrders ?? 0) + 1,
        totalRevenue: (prevStats.totalRevenue ?? 0) + totalAmount,
      },
      updatedAt: serverTimestamp(),
    });

    return {
      orderId: orderRef.id,
      orderNumber,
      ...(timedPromoDueAt
        ? { timedPromoPaymentDueAt: timedPromoDueAt.toDate().toISOString() }
        : {}),
    };
  });
}

export async function listFeituanOrders(): Promise<OrderRow[]> {
  const db = getDb();
  const q = query(collection(db, 'orders'), where('channel', '==', 'feituan'));
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() as OrderDoc }));
  rows.sort((a, b) => {
    const ta = a.data.createdAt?.toMillis?.() ?? 0;
    const tb = b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows;
}

export async function listOrdersByCustomer(projectId: string, customerKey: string): Promise<OrderRow[]> {
  const ck = `${projectId}::${customerKey}`;
  const now = Date.now();
  const hit = customerOrdersCache.get(ck);
  if (hit && !hit.pending && now - hit.at < ORDERS_CACHE_TTL_MS) {
    return hit.rows;
  }
  if (hit?.pending) return hit.pending;

  const db = getDb();
  const pending = (async () => {
    const q = query(
      collection(db, 'orders'),
      where('projectId', '==', projectId),
      where('customerKey', '==', customerKey)
    );
    const snap = await getDocs(q);
    const rows = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as OrderDoc }))
      .sort((a, b) => {
        const ta = a.data.createdAt?.toMillis?.() ?? 0;
        const tb = b.data.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
    await Promise.all(
      rows.map(async (row) => {
        const orderRef = doc(db, 'orders', row.id);
        row.data = await autoCancelExpiredTimedPromoOrder(orderRef, row.data);
      })
    );
    customerOrdersCache.set(ck, { at: Date.now(), rows });
    return rows;
  })();

  customerOrdersCache.set(ck, {
    at: hit?.at ?? 0,
    rows: hit?.rows ?? [],
    pending,
  });
  try {
    return await pending;
  } finally {
    const latest = customerOrdersCache.get(ck);
    if (latest?.pending === pending) {
      customerOrdersCache.set(ck, {
        at: latest.at,
        rows: latest.rows,
      });
    }
  }
}

async function md5DuplicateInShopOtherOrders(
  shopId: string,
  excludeOrderId: string,
  md5: string
): Promise<boolean> {
  const rows = await listOrdersByShopId(shopId);
  for (const row of rows) {
    if (row.id === excludeOrderId) continue;
    const shots = row.data.paymentScreenshots;
    if (!Array.isArray(shots)) continue;
    for (const s of shots) {
      if (!s || typeof s !== 'object') continue;
      const h = (s as Record<string, unknown>).md5Hash;
      if (typeof h === 'string' && h === md5) return true;
    }
  }
  return false;
}

function pickPaymentGroupBoundaryBatchIdForNewScreenshot(order: OrderDoc): string | undefined {
  const groups = buildPaymentGroups(order);
  const target =
    groups.find((g) => g.status === 'unpaid') ??
    [...groups].reverse().find((g) => g.status === 'pending');
  const ids = target?.appendBatchIds ?? [];
  return ids.length > 0 ? ids[ids.length - 1] : undefined;
}

/** 顾客上传付款截图：校验本人；写入 Storage URL + MD5 标记；待付款则改为待核实 */
export async function customerUploadPaymentScreenshot(input: {
  orderFirestoreId: string;
  projectId: string;
  orderNumber: string;
  customerKey: string;
  file: File;
}): Promise<void> {
  const mimeIn = input.file.type || '';
  if (!mimeIn.startsWith('image/')) throw new Error('请上传图片文件');

  let file = await compressImageFileForUpload(input.file);

  const maxBytes = 8 * 1024 * 1024;
  if (file.size > maxBytes) throw new Error('图片请勿超过 8MB');
  const mime = file.type || '';
  if (!mime.startsWith('image/')) throw new Error('请上传图片文件');

  const allowUpload: OrderStatus[] = ['unpaid', 'pending', 'partial_paid'];

  const db = getDb();
  const orderRef = doc(db, 'orders', input.orderFirestoreId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('订单不存在');
  let order = snap.data() as OrderDoc;
  order = await autoCancelExpiredTimedPromoOrder(orderRef, order);

  if (
    order.projectId !== input.projectId ||
    order.orderNumber !== input.orderNumber
  ) {
    throw new Error('订单信息不匹配');
  }
  if (order.customerKey !== input.customerKey) {
    throw new Error('仅下单本人可上传付款截图（请使用同一浏览器）');
  }
  if (!allowUpload.includes(order.status)) {
    if (order.status === 'cancelled') throw new Error('订单已取消');
    if (order.status === 'confirmed') throw new Error('订单已确认，无需再上传');
    throw new Error('当前状态不可上传付款截图');
  }

  const md5 = await computeImageFileMd5Hex(file);

  /** 本单内 MD5 重复：仅打旗标提示风险，不拦截上传 */
  const existingShots = Array.isArray(order.paymentScreenshots)
    ? order.paymentScreenshots
    : [];
  const dupSameOrder = existingShots.some((s) => {
    if (!s || typeof s !== 'object') return false;
    const h = (s as Record<string, unknown>).md5Hash;
    return typeof h === 'string' && h === md5;
  });

  const dup = await md5DuplicateInShopOtherOrders(
    order.shopId,
    input.orderFirestoreId,
    md5
  );

  const uploadedAt = Timestamp.now();
  const uploadMs = uploadedAt.toMillis();
  const createdMs = order.createdAt?.toMillis?.() ?? 0;

  let flag: 'green' | 'yellow' | 'red' = 'green';
  let flagReason: string | undefined;
  if (dup) {
    flag = 'red';
    flagReason = 'MD5 与该商户其他订单截图重复';
  } else if (dupSameOrder) {
    flag = 'yellow';
    flagReason =
      '本订单已存在相同内容的截图（MD5 一致），请核对是否重复使用凭证';
  } else if (uploadMs < createdMs) {
    flag = 'yellow';
    flagReason = '截图上传时间早于下单时间';
  }

  const url = await uploadOrderPaymentImage({
    shopId: order.shopId,
    orderId: input.orderFirestoreId,
    file,
  });

  const entry: Record<string, unknown> = {
    id: globalThis.crypto.randomUUID(),
    url,
    uploadedAt,
    md5Hash: md5,
    flag,
  };
  if (flagReason) entry.flagReason = flagReason;

  /** 支付动作按宪法归属到当前支付组边界；支付前所有加购与下单同属一组。 */
  const batchId = pickPaymentGroupBoundaryBatchIdForNewScreenshot(order);
  if (batchId) entry.appendBatchId = batchId;

  const prev = Array.isArray(order.paymentScreenshots)
    ? [...order.paymentScreenshots]
    : [];
  prev.push(withDefaultScreenshotFlagIfUrl(entry));

  const hist = [...(order.statusHistory ?? [])];
  hist.push({
    action: 'screenshot_uploaded',
    timestamp: Timestamp.now(),
  });

  await updateDoc(orderRef, {
    paymentScreenshots: prev,
    statusHistory: hist,
    updatedAt: serverTimestamp(),
    ...(order.status === 'unpaid' ? { status: 'pending' as const } : {}),
  });
}

/** 顾客删除一张付款截图（传错可删）；删光且原为待核实则回到待付款 */
export async function customerDeletePaymentScreenshot(input: {
  orderFirestoreId: string;
  projectId: string;
  orderNumber: string;
  customerKey: string;
  /** 新数据有条目 id 时优先使用 */
  screenshotId?: string;
  /** 旧数据无 id 时可按 url 匹配第一条 */
  screenshotUrl?: string;
}): Promise<void> {
  const idTrim = input.screenshotId?.trim();
  const urlTrim = input.screenshotUrl?.trim();
  if (!idTrim && !urlTrim) throw new Error('缺少要删除的截图');

  const allow: OrderStatus[] = ['unpaid', 'pending', 'partial_paid'];

  const db = getDb();
  const orderRef = doc(db, 'orders', input.orderFirestoreId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('订单不存在');
  let order = snap.data() as OrderDoc;
  order = await autoCancelExpiredTimedPromoOrder(orderRef, order);

  if (
    order.projectId !== input.projectId ||
    order.orderNumber !== input.orderNumber
  ) {
    throw new Error('订单信息不匹配');
  }
  if (order.customerKey !== input.customerKey) {
    throw new Error('仅下单本人可操作（请使用同一浏览器）');
  }
  if (!allow.includes(order.status)) {
    if (order.status === 'cancelled') throw new Error('订单已取消');
    if (order.status === 'confirmed') throw new Error('订单已确认，无法删除凭证');
    throw new Error('当前状态不可删除付款截图');
  }

  const prev = Array.isArray(order.paymentScreenshots)
    ? [...order.paymentScreenshots]
    : [];

  let idx = -1;
  if (idTrim) {
    idx = prev.findIndex((s) => {
      if (!s || typeof s !== 'object') return false;
      return (s as Record<string, unknown>).id === idTrim;
    });
  }
  if (idx < 0 && urlTrim) {
    idx = prev.findIndex((s) => {
      if (!s || typeof s !== 'object') return false;
      const u = (s as Record<string, unknown>).url;
      return typeof u === 'string' && u.trim() === urlTrim;
    });
  }
  if (idx < 0) throw new Error('找不到该截图');

  const removed = prev[idx] as Record<string, unknown>;
  const removedBatchId =
    typeof removed.appendBatchId === 'string' && removed.appendBatchId.trim()
      ? removed.appendBatchId.trim()
      : '';
  const removedUploadedAt =
    removed.uploadedAt &&
    typeof (removed.uploadedAt as { toMillis?: () => number }).toMillis ===
      'function'
      ? (removed.uploadedAt as { toMillis: () => number }).toMillis()
      : null;
  const appendBatches = order.appendBatches ?? [];
  const pendingBatches = appendBatches.filter((b) => !b.confirmedAt);

  // 商户已确认过的凭证对顾客只读，防止删除后账务与核实记录不一致。
  if (removedBatchId) {
    const batch = appendBatches.find((b) => b.id === removedBatchId);
    if (batch?.confirmedAt) {
      throw new Error('该凭证对应的补款已被商户确认，不能删除');
    }
  } else {
    const minPendingMs =
      pendingBatches.length > 0
        ? Math.min(...pendingBatches.map((b) => b.appendedAt.toMillis()))
        : Number.POSITIVE_INFINITY;
    const likelyPendingAppendProof =
      removedUploadedAt != null &&
      pendingBatches.length > 0 &&
      removedUploadedAt >= minPendingMs;
    if (!likelyPendingAppendProof && order.initialPaymentConfirmedAt) {
      throw new Error('该已确认支付组的凭证不能删除');
    }
  }

  const fileUrl = typeof removed.url === 'string' ? removed.url.trim() : '';
  const next = prev.filter((_, i) => i !== idx);

  if (fileUrl) {
    try {
      await deleteFileByDownloadUrl(fileUrl);
    } catch {
      // 仍更新 Firestore，避免用户无法纠正错误记录
    }
  }

  const stillHas = orderHasPaymentScreenshots(next);
  const hist = [...(order.statusHistory ?? [])];
  hist.push({
    action: 'screenshot_deleted',
    timestamp: Timestamp.now(),
  });

  await updateDoc(orderRef, {
    paymentScreenshots: next,
    statusHistory: hist,
    updatedAt: serverTimestamp(),
    ...(order.status === 'pending' && !stillHas
      ? { status: 'unpaid' as const }
      : {}),
  });
}

export async function getOrderByNumber(projectId: string, orderNumber: string): Promise<OrderRow | null> {
  const db = getDb();
  const q = query(
    collection(db, 'orders'),
    where('projectId', '==', projectId),
    where('orderNumber', '==', orderNumber),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const orderRef = doc(db, 'orders', d.id);
  let data = d.data() as OrderDoc;
  data = await autoCancelExpiredTimedPromoOrder(orderRef, data);
  return { id: d.id, data };
}

/** 顾客修改联系信息（项目未截单、订单未取消） */
export async function customerUpdateOrderContact(input: {
  orderFirestoreId: string;
  projectId: string;
  orderNumber: string;
  customerKey: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNote?: string;
  /** 一并更新配送方式（可选） */
  delivery?: {
    deliveryPointId?: string;
    deliveryPointSnapshot: { name: string; detail?: string };
    isManualMatch: boolean;
  };
}): Promise<void> {
  const projectRow = await getProject(input.projectId);
  if (!projectRow) throw new Error('项目不存在');
  ensureProjectAllowsCustomerEdit(projectRow.data);

  const db = getDb();
  const orderRef = doc(db, 'orders', input.orderFirestoreId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('订单不存在');
  const order = snap.data() as OrderDoc;

  if (
    order.projectId !== input.projectId ||
    order.orderNumber !== input.orderNumber
  ) {
    throw new Error('订单信息不匹配');
  }
  if (order.customerKey !== input.customerKey) {
    throw new Error('仅下单本人可修改（请使用同一浏览器）');
  }
  if (order.status === 'cancelled') throw new Error('订单已取消');

  const allow: OrderStatus[] = [
    'unpaid',
    'pending',
    'confirmed',
    'partial_paid',
  ];
  if (!allow.includes(order.status)) {
    throw new Error('当前状态不可修改信息');
  }

  const nm = input.customerName.trim();
  const ph = input.customerPhone.trim();
  const ad = input.customerAddress.trim();
  if (!nm || !ph || !ad) throw new Error('姓名、电话、地址不能为空');

  if (input.delivery) {
    const { isManualMatch, deliveryPointId, deliveryPointSnapshot } =
      input.delivery;
    const nameOk = deliveryPointSnapshot?.name?.trim();
    if (!nameOk) throw new Error('配送信息不完整');

    if (!isManualMatch) {
      const dpId = deliveryPointId?.trim();
      if (!dpId) throw new Error('请选择配送点');

      const shopRow = await getShopById(order.shopId);
      if (!shopRow) throw new Error('店铺不存在');
      const rows = await listDeliveryPointsByOwnerId(shopRow.data.ownerId, {
        fallbackShopId: order.shopId,
      });
      const okRow = rows.find((r) => r.id === dpId);
      if (!okRow) throw new Error('配送点不存在或已停用');

      const allowed = new Set(projectRow.data.deliveryPointIds ?? []);
      if (allowed.size > 0 && !allowed.has(dpId)) {
        throw new Error('该配送点不属于当前团购项目');
      }
    }
  }

  const hist = [...(order.statusHistory ?? [])];
  hist.push({
    action: 'customer_update_contact',
    timestamp: Timestamp.now(),
  });

  const noteTrim = input.customerNote?.trim();

  const patch: Record<string, unknown> = {
    customerName: nm,
    customerPhone: ph,
    customerAddress: ad,
    customerNote: noteTrim ? noteTrim : deleteField(),
    statusHistory: hist,
    updatedAt: serverTimestamp(),
  };

  if (input.delivery) {
    const { isManualMatch, deliveryPointId, deliveryPointSnapshot } =
      input.delivery;
    patch.isManualMatch = isManualMatch;
    patch.deliveryPointSnapshot = deliveryPointSnapshot;
    if (!isManualMatch && deliveryPointId?.trim()) {
      patch.deliveryPointId = deliveryPointId.trim();
    } else {
      patch.deliveryPointId = deleteField();
    }
  }

  await updateDoc(orderRef, patch);
}

/** 顾客加购（仅加数量、扣库存；已确认订单会变为待补付款） */
export async function customerAppendLinesToOrder(input: {
  orderFirestoreId: string;
  projectId: string;
  orderNumber: string;
  customerKey: string;
  additionalLines: OrderLine[];
  bundleSelections?: BundleSelectionDraft[];
}): Promise<void> {
  if (!input.additionalLines.length) throw new Error('请选择要加购的商品');

  const db = getDb();
  const orderRef = doc(db, 'orders', input.orderFirestoreId);
  const projectRef = doc(db, 'projects', input.projectId);

  await runTransaction(db, async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists()) throw new Error('项目不存在');
    const project = projectSnap.data() as ProjectDoc;
    ensureProjectAllowsCustomerEdit(project);

    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error('订单不存在');
    const order = orderSnap.data() as OrderDoc;

    if (
      order.projectId !== input.projectId ||
      order.orderNumber !== input.orderNumber
    ) {
      throw new Error('订单信息不匹配');
    }
    if (order.customerKey !== input.customerKey) {
      throw new Error('仅下单本人可加菜（请使用同一浏览器）');
    }
    if (order.shopId !== project.shopId) throw new Error('数据不一致');
    if (order.status === 'cancelled') throw new Error('订单已取消');

    if (
      order.status !== 'unpaid' &&
      order.status !== 'pending' &&
      order.status !== 'confirmed' &&
      order.status !== 'partial_paid'
    ) {
      throw new Error('当前状态不可加菜');
    }

    const newLineDocs = toOrderLines(input.additionalLines);
    const normalLines = input.additionalLines.filter(
      (l) => !String(l.productId ?? '').startsWith('bundle:')
    );
    const nextProducts = applyStockDeduction(project, normalLines);
    const nextBundleTools = applyBundleStockDeduction(
      project,
      input.bundleSelections
    );
    const delta = computeTotal(newLineDocs);
    if (delta <= 0) throw new Error('加购金额无效');

    let nextInitialLines = order.initialLines;
    let nextInitialTotal = order.initialTotalAmount;
    if (!nextInitialLines?.length) {
      nextInitialLines = order.lines;
      nextInitialTotal = order.totalAmount;
    }

    const prevBatches = [...(order.appendBatches ?? [])];
    const pendingIds = prevBatches
      .filter((b) => !b.confirmedAt)
      .map((b) => b.id);

    let lastOpenIdx = -1;
    for (let i = prevBatches.length - 1; i >= 0; i--) {
      if (!prevBatches[i]?.confirmedAt) {
        lastOpenIdx = i;
        break;
      }
    }

    const openBatch =
      lastOpenIdx >= 0 ? prevBatches[lastOpenIdx]! : null;
    /** 仅当「最后一档待确认加购」尚未上传任何凭证时才合并；已上传则新开一档 */
    const mergeIntoOpenBatch =
      openBatch != null &&
      !appendBatchHasCustomerUpload(
        order.paymentScreenshots,
        openBatch.id,
        openBatch.appendedAt,
        pendingIds
      );

    let appendBatches: OrderAppendBatchDoc[];
    let batchIdForNote: string;

    if (mergeIntoOpenBatch) {
      const cur = openBatch!;
      batchIdForNote = cur.id;
      const mergedBatch: OrderAppendBatchDoc = {
        ...cur,
        lines: [...cur.lines, ...newLineDocs],
        deltaAmount: cur.deltaAmount + delta,
      };
      appendBatches = [...prevBatches];
      appendBatches[lastOpenIdx] = mergedBatch;
    } else {
      const batchId = globalThis.crypto.randomUUID();
      batchIdForNote = batchId;
      const newBatch: OrderAppendBatchDoc = {
        id: batchId,
        appendedAt: Timestamp.now(),
        lines: newLineDocs,
        deltaAmount: delta,
      };
      appendBatches = [...prevBatches, newBatch];
    }

    const mergedLines = [...order.lines, ...newLineDocs];
    const newTotal = computeTotal(mergedLines);
    const paid = Number(order.paidAmount) || 0;
    const newPending = Math.max(0, newTotal - paid);

    const nextStatus: OrderStatus =
      order.status === 'confirmed' ? 'partial_paid' : order.status;

    const hist = [...(order.statusHistory ?? [])];
    hist.push({
      action: 'customer_append_lines',
      timestamp: Timestamp.now(),
      note: `+${delta.toFixed(2)} batch=${batchIdForNote}`,
    });

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };

    tx.update(orderRef, {
      lines: mergedLines,
      initialLines: nextInitialLines,
      initialTotalAmount: nextInitialTotal,
      appendBatches,
      totalAmount: newTotal,
      pendingAmount: newPending,
      status: nextStatus,
      statusHistory: hist,
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      products: nextProducts,
      bundleTools: nextBundleTools,
      stats: {
        ...prevStats,
        totalRevenue: (prevStats.totalRevenue ?? 0) + delta,
      },
      updatedAt: serverTimestamp(),
    });
  });
}

/** 商户端：按店铺拉取订单（客户端按时间倒序，避免复合索引） */
export async function listOrdersByShopId(
  shopId: string,
  options?: { bypassCache?: boolean }
): Promise<OrderRow[]> {
  if (options?.bypassCache) {
    shopOrdersCache.delete(shopId);
  }
  const now = Date.now();
  const hit = shopOrdersCache.get(shopId);
  if (hit && !hit.pending && now - hit.at < ORDERS_CACHE_TTL_MS) {
    return hit.rows;
  }
  if (hit?.pending) return hit.pending;

  const db = getDb();
  const pending = (async () => {
    const q = query(collection(db, 'orders'), where('shopId', '==', shopId));
    const snap = await getDocs(q);
    const rows = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as OrderDoc }))
      .sort((a, b) => {
        const ta = a.data.createdAt?.toMillis?.() ?? 0;
        const tb = b.data.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
    for (const row of rows) {
      const next = buildAutoCancelledTimedPromoOrder(row.data);
      if (!next) continue;
      row.data = next;
      const orderRef = doc(db, 'orders', row.id);
      void updateDoc(orderRef, {
        status: 'cancelled' as const,
        statusHistory: next.statusHistory ?? [],
        updatedAt: serverTimestamp(),
      }).catch(() => {
        // 非阻塞刷新：列表优先返回，落库失败不影响当前读取结果。
      });
    }
    shopOrdersCache.set(shopId, { at: Date.now(), rows });
    return rows;
  })();

  shopOrdersCache.set(shopId, {
    at: hit?.at ?? 0,
    rows: hit?.rows ?? [],
    pending,
  });
  try {
    return await pending;
  } finally {
    const latest = shopOrdersCache.get(shopId);
    if (latest?.pending === pending) {
      shopOrdersCache.set(shopId, {
        at: latest.at,
        rows: latest.rows,
      });
    }
  }
}

/**
 * 首笔应收（一次确认只认这一档）：优先 initialTotalAmount / initialLines；
 * 无快照时（历史数据）用「当前应付 − 未确认加购档合计」估算。
 */
function computeFirstTrancheAmount(o: OrderDoc): number {
  const total = Number(o.totalAmount) || 0;
  const pendingAppendSum = (o.appendBatches ?? [])
    .filter((b) => !b.confirmedAt)
    .reduce((s, b) => s + (Number(b.deltaAmount) || 0), 0);

  if (typeof o.initialTotalAmount === 'number' && o.initialTotalAmount > 0.001) {
    return o.initialTotalAmount;
  }
  const lines = o.initialLines;
  if (lines?.length) {
    const sum = lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
    if (sum > 0.001) return sum;
  }
  if (pendingAppendSum > 0.001) {
    return Math.max(0, total - pendingAppendSum);
  }
  return total;
}

function hasUnconfirmedAppendBatch(o: OrderDoc): boolean {
  return (o.appendBatches ?? []).some((b) => !b.confirmedAt);
}

async function assertMerchantCanManageOrder(
  actorUserId: string,
  order: OrderDoc
): Promise<void> {
  if (order.channel === 'feituan') {
    if (await isFeituanAdmin(actorUserId)) return;
    throw new Error('饭团订单由饭团管理员确认与管理');
  }
  const shop = await getShopById(order.shopId);
  if (!shop) throw new Error('店铺不存在');
  if (shop.data.ownerId === actorUserId) return;
  const perm = await getProjectPermissionForUser(actorUserId, order.projectId);
  if (
    perm &&
    perm.data.projectId === order.projectId &&
    (perm.data.role === 'normal_admin' || perm.data.role === 'high_admin')
  ) {
    return;
  }
  throw new Error('无权限操作该订单');
}

export async function merchantConfirmPaymentGroup(
  orderFirestoreId: string,
  paymentGroupId: string,
  actorUserId: string
): Promise<void> {
  const groupId = paymentGroupId.trim();
  if (!groupId) throw new Error('缺少支付组');

  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);
  if (pre.status === 'cancelled') throw new Error('订单已取消');

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (o.status === 'cancelled') throw new Error('订单已取消');

    const groups = buildPaymentGroups(o);
    const group = groups.find((g) => g.id === groupId);
    if (!group) throw new Error('支付组不存在，请刷新后重试');
    if (group.status === 'confirmed') throw new Error('该支付组已确认');
    if (group.status !== 'pending') {
      throw new Error('该支付组尚未发生支付动作，不能确认收款');
    }

    const projectRef = doc(db, 'projects', o.projectId);
    const pSnap = await tx.get(projectRef);
    if (!pSnap.exists()) throw new Error('项目不存在');
    const project = pSnap.data() as ProjectDoc;
    if (project.shopId !== o.shopId) throw new Error('数据不一致');

    const now = Timestamp.now();
    const batchIds = new Set(group.appendBatchIds);
    const batches = [...(o.appendBatches ?? [])].map((b) =>
      batchIds.has(b.id) && !b.confirmedAt
        ? { ...b, confirmedAt: now, confirmedByUserId: actorUserId }
        : b
    );

    const initialSupplement =
      group.includesInitial && !o.initialPaymentConfirmedAt
        ? Number(o.initialTotalAmount ?? computeFirstTrancheAmount(o)) || 0
        : 0;
    const appendSupplement = (o.appendBatches ?? [])
      .filter((b) => batchIds.has(b.id) && !b.confirmedAt)
      .reduce((s, b) => s + (Number(b.deltaAmount) || 0), 0);
    const supplement = initialSupplement + appendSupplement;
    if (supplement <= 0.001) throw new Error('该支付组没有可确认金额');

    const totalAmt = Number(o.totalAmount) || 0;
    const paidBefore = Number(o.paidAmount) || 0;
    const newPaid = Math.min(totalAmt, paidBefore + supplement);
    const newPending = Math.max(0, totalAmt - newPaid);
    const nextStatus: OrderStatus =
      newPending <= 0.001 ? 'confirmed' : 'partial_paid';

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'confirm_payment_group',
      timestamp: now,
      userId: actorUserId,
      note: `${group.id};amount=${supplement.toFixed(2)};batches=${group.appendBatchIds.join(',')}`,
    });

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };

    tx.update(orderRef, {
      status: nextStatus,
      paidAmount: newPaid,
      pendingAmount: newPending,
      appendBatches: batches,
      ...(group.includesInitial && !o.initialPaymentConfirmedAt
        ? { initialPaymentConfirmedAt: now }
        : {}),
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      stats: {
        ...prevStats,
        confirmedRevenue: (prevStats.confirmedRevenue ?? 0) + supplement,
        ...(nextStatus === 'confirmed' && o.status !== 'confirmed'
          ? { confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1 }
          : {}),
        ...(group.includesInitial && !o.initialPaymentConfirmedAt
          ? { unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1) }
          : {}),
      },
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * 对账单「其他地址」：商户把订单关联到已有配送点，或确认继续按详细地址配送（仅留痕）。
 */
export async function merchantAssignManualDeliveryMatch(input: {
  orderFirestoreId: string;
  actorUserId: string;
  /** 配送点文档 id；null 表示不匹配配送点，继续按地址配送 */
  deliveryPointId: string | null;
}): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', input.orderFirestoreId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('订单不存在');
  let order = snap.data() as OrderDoc;
  order = await autoCancelExpiredTimedPromoOrder(orderRef, order);

  await assertMerchantCanManageOrder(input.actorUserId, order);

  if (!order.isManualMatch) {
    throw new Error('该订单已不是「其他地址」类型，无需在此匹配');
  }

  const hist = [...(order.statusHistory ?? [])];

  if (!input.deliveryPointId?.trim()) {
    hist.push({
      action: 'merchant_manual_dispatch_by_address',
      timestamp: Timestamp.now(),
      userId: input.actorUserId,
    });
    await updateDoc(orderRef, {
      statusHistory: hist,
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const dpId = input.deliveryPointId.trim();
  const shopRow = await getShopById(order.shopId);
  if (!shopRow) throw new Error('店铺不存在');
  const dpRows = await listDeliveryPointsByOwnerId(shopRow.data.ownerId, {
    fallbackShopId: order.shopId,
  });
  const dpRow = dpRows.find((r) => r.id === dpId);
  if (!dpRow) throw new Error('配送点不存在');

  const projectRow = await getProject(order.projectId);
  if (!projectRow) throw new Error('项目不存在');
  const allowed = new Set(projectRow.data.deliveryPointIds ?? []);
  if (allowed.size > 0 && !allowed.has(dpId)) {
    throw new Error('该配送点不属于当前团购项目的可选范围');
  }

  const docDp = dpRow.data;
  const shortName = (docDp.shortName ?? docDp.name ?? '').trim() || '配送点';
  const code = (docDp.code ?? '').trim();
  const snapshotName = code ? `[${code}] ${shortName}` : shortName;
  const detailPart = docDp.detailAddress?.trim();

  hist.push({
    action: 'merchant_assigned_delivery_point',
    timestamp: Timestamp.now(),
    userId: input.actorUserId,
    note: dpId,
  });

  await updateDoc(orderRef, {
    deliveryPointId: dpId,
    isManualMatch: false,
    deliveryPointSnapshot: {
      name: snapshotName,
      ...(detailPart ? { detail: detailPart } : {}),
    },
    statusHistory: hist,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 商户确认「首笔」收款（顾客一次提交、多张凭证仍算首笔）：只入账首单小计对应金额。
 * 若仍有未确认的加购档，订单进入 partial_paid，加购须另行逐笔/按批确认，避免整单误确认。
 */
export async function merchantConfirmPayment(
  orderFirestoreId: string,
  actorUserId: string
): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);

  if (pre.status === 'confirmed') throw new Error('订单已是已确认状态');
  if (pre.status === 'cancelled') throw new Error('订单已取消');
  if (pre.initialPaymentConfirmedAt) {
    throw new Error('该支付组已确认，无需重复确认');
  }
  if (
    pre.status !== 'unpaid' &&
    pre.status !== 'pending' &&
    pre.status !== 'partial_paid'
  ) {
    throw new Error('当前状态不可确认收款');
  }

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (o.initialPaymentConfirmedAt) {
      throw new Error('该支付组已确认，无需重复确认');
    }
    if (
      o.status !== 'unpaid' &&
      o.status !== 'pending' &&
      o.status !== 'partial_paid'
    ) {
      throw new Error('订单状态已变更，请刷新后重试');
    }

    const projectRef = doc(db, 'projects', o.projectId);
    const pSnap = await tx.get(projectRef);
    if (!pSnap.exists()) throw new Error('项目不存在');
    const project = pSnap.data() as ProjectDoc;
    if (project.shopId !== o.shopId) throw new Error('数据不一致');

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };

    const totalAmt = Number(o.totalAmount) || 0;
    const paidBefore = Number(o.paidAmount) || 0;
    const openAppend = hasUnconfirmedAppendBatch(o);
    const firstPay = computeFirstTrancheAmount(o);
    if (firstPay <= 0) throw new Error('无法计算该支付组可确认金额');
    if (firstPay > totalAmt + 0.02) {
      throw new Error('支付组金额与订单合计不一致，请刷新后重试');
    }
    const initialSupplement = Math.max(
      0,
      Math.min(firstPay, Math.max(0, totalAmt - paidBefore))
    );

    const history = [...(o.statusHistory ?? [])];

    /** 只要还有未入账的加购档，首笔确认永远不整单结清、不自动勾选加购批次 */
    if (!openAppend) {
      history.push({
        action: 'confirm_payment',
        timestamp: Timestamp.now(),
        userId: actorUserId,
      });

      tx.update(orderRef, {
        status: 'confirmed',
        paidAmount: totalAmt,
        pendingAmount: 0,
        appendBatches: o.appendBatches ?? [],
        initialPaymentConfirmedAt: o.initialPaymentConfirmedAt ?? Timestamp.now(),
        statusHistory: history,
        updatedAt: serverTimestamp(),
      });

      tx.update(projectRef, {
        stats: {
          ...prevStats,
          confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1,
          unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1),
          confirmedRevenue:
            (prevStats.confirmedRevenue ?? 0) + initialSupplement,
        },
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const newPaid = Math.min(totalAmt, paidBefore + initialSupplement);
    const nextPending = Math.max(0, totalAmt - newPaid);
    history.push({
      action: 'confirm_initial_payment',
      timestamp: Timestamp.now(),
      userId: actorUserId,
      note: `initial=${firstPay.toFixed(2)}`,
    });

    tx.update(orderRef, {
      status: 'partial_paid',
      paidAmount: newPaid,
      pendingAmount: nextPending,
      appendBatches: o.appendBatches ?? [],
      initialPaymentConfirmedAt: o.initialPaymentConfirmedAt ?? Timestamp.now(),
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      stats: {
        ...prevStats,
        unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1),
        confirmedRevenue:
          (prevStats.confirmedRevenue ?? 0) + initialSupplement,
      },
      updatedAt: serverTimestamp(),
    });
  });
}

/** 商户将首单待付款标记为「免提交付款凭证」，使其进入待确认。 */
export async function merchantWaiveInitialPaymentScreenshot(
  orderFirestoreId: string,
  actorUserId: string
): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);
  if (pre.status === 'cancelled' || pre.status === 'confirmed') {
    throw new Error('当前状态不可免提交凭证');
  }

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (o.status === 'cancelled' || o.status === 'confirmed') {
      throw new Error('订单状态已变更，请刷新后重试');
    }
    if (o.initialPaymentConfirmedAt) {
      throw new Error('该支付组已确认，无需免提交');
    }

    const hasInitialProof = Array.isArray(o.paymentScreenshots)
      ? o.paymentScreenshots.some((raw) => {
          if (!raw || typeof raw !== 'object') return false;
          const item = raw as Record<string, unknown>;
          const bid =
            typeof item.appendBatchId === 'string' ? item.appendBatchId.trim() : '';
          if (bid) return false;
          const hasUrl = typeof item.url === 'string' && item.url.trim().length > 0;
          const waived = item.waivedNoScreenshot === true;
          return hasUrl || waived;
        })
      : false;
    if (hasInitialProof) {
      throw new Error('该支付组已有可核对凭证，无需免提交');
    }

    const prevShots = Array.isArray(o.paymentScreenshots)
      ? [...o.paymentScreenshots]
      : [];
    prevShots.push({
      id: globalThis.crypto.randomUUID(),
      uploadedAt: Timestamp.now(),
      waivedNoScreenshot: true,
      waivedByUserId: actorUserId,
      flag: 'yellow',
      flagReason: '商户已免提交付款凭证（支付组）',
    });

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'merchant_waive_initial_payment_screenshot',
      timestamp: Timestamp.now(),
      userId: actorUserId,
    });

    tx.update(orderRef, {
      paymentScreenshots: prevShots,
      statusHistory: history,
      updatedAt: serverTimestamp(),
      ...(o.status === 'unpaid' ? { status: 'pending' as const } : {}),
    });
  });
}

/** 商户确认某一档加购的补款（仅订单处于待补付款且该档未确认时） */
export async function merchantConfirmAppendBatch(
  orderFirestoreId: string,
  appendBatchId: string,
  actorUserId: string,
  _options?: { includeInitialPayment?: boolean }
): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);

  if (
    pre.status !== 'unpaid' &&
    pre.status !== 'pending' &&
    pre.status !== 'partial_paid'
  ) {
    throw new Error('当前状态不可按笔确认加购补款');
  }

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (
      o.status !== 'unpaid' &&
      o.status !== 'pending' &&
      o.status !== 'partial_paid'
    ) {
      throw new Error('订单状态已变更，请刷新后重试');
    }

    const projectRef = doc(db, 'projects', o.projectId);
    const pSnap = await tx.get(projectRef);
    if (!pSnap.exists()) throw new Error('项目不存在');
    const project = pSnap.data() as ProjectDoc;
    if (project.shopId !== o.shopId) throw new Error('数据不一致');

    const batches = [...(o.appendBatches ?? [])];
    const idx = batches.findIndex((b) => b.id === appendBatchId);
    if (idx < 0) throw new Error('找不到该加购记录');
    const batch = batches[idx]!;
    if (batch.confirmedAt) throw new Error('该笔加购已确认');

    const pendingIds = batches.filter((b) => !b.confirmedAt).map((b) => b.id);
    if (
      !canMerchantConfirmAppendBatchByScreenshots(
        o.paymentScreenshots,
        appendBatchId,
        pendingIds,
        batch.appendedAt
      )
    ) {
      throw new Error('该笔加购尚未上传对应付款截图，请待顾客提交后再确认');
    }

    const supplement = Number(batch.deltaAmount) || 0;
    if (supplement <= 0) throw new Error('该笔加购金额无效');
    const now = Timestamp.now();
    // 单组确认必须是“只确认当前组”，禁止夹带首组确认。
    const includeInitial = false;
    const confirmInitialInSameAction = includeInitial && !o.initialPaymentConfirmedAt;
    const initialSupplement = confirmInitialInSameAction
      ? Math.max(0, computeFirstTrancheAmount(o))
      : 0;

    const paidBefore = Number(o.paidAmount) || 0;
    const newPaid = paidBefore + supplement + initialSupplement;
    const newPending = Math.max(0, (Number(o.totalAmount) || 0) - newPaid);
    const nextStatus: OrderStatus =
      newPending <= 0.001 ? 'confirmed' : 'partial_paid';

    batches[idx] = {
      ...batch,
      confirmedAt: now,
      confirmedByUserId: actorUserId,
    };

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'confirm_append_batch',
      timestamp: now,
      userId: actorUserId,
      note: appendBatchId,
    });
    if (confirmInitialInSameAction && initialSupplement > 0.001) {
      history.push({
        action: 'confirm_initial_payment',
        timestamp: now,
        userId: actorUserId,
        note: `merged_with_append=${appendBatchId};initial=${initialSupplement.toFixed(2)}`,
      });
    }

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };

    tx.update(orderRef, {
      appendBatches: batches,
      paidAmount: newPaid,
      pendingAmount: newPending,
      status: nextStatus,
      ...(confirmInitialInSameAction
        ? { initialPaymentConfirmedAt: now }
        : {}),
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      stats: {
        ...prevStats,
        confirmedRevenue:
          (prevStats.confirmedRevenue ?? 0) + supplement + initialSupplement,
        ...(confirmInitialInSameAction
          ? { unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1) }
          : {}),
        ...(nextStatus === 'confirmed'
          ? { confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1 }
          : {}),
      },
      updatedAt: serverTimestamp(),
    });
  });
}

/** 商户将某个待付款加购组标记为「免提交付款凭证」，使其进入待确认。 */
export async function merchantWaiveAppendBatchScreenshot(
  orderFirestoreId: string,
  appendBatchId: string,
  actorUserId: string
): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);
  if (pre.status === 'cancelled' || pre.status === 'confirmed') {
    throw new Error('当前状态不可免提交凭证');
  }

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (o.status === 'cancelled' || o.status === 'confirmed') {
      throw new Error('订单状态已变更，请刷新后重试');
    }

    const batches = o.appendBatches ?? [];
    const batch = batches.find((b) => b.id === appendBatchId);
    if (!batch) throw new Error('找不到该加购记录');
    if (batch.confirmedAt) throw new Error('该笔加购已确认，无需免提交');

    const pendingIds = batches.filter((b) => !b.confirmedAt).map((b) => b.id);
    if (
      canMerchantConfirmAppendBatchByScreenshots(
        o.paymentScreenshots,
        appendBatchId,
        pendingIds,
        batch.appendedAt
      )
    ) {
      throw new Error('该组已有可核对凭证，无需免提交');
    }

    const prevShots = Array.isArray(o.paymentScreenshots)
      ? [...o.paymentScreenshots]
      : [];
    prevShots.push({
      id: globalThis.crypto.randomUUID(),
      appendBatchId,
      uploadedAt: Timestamp.now(),
      waivedNoScreenshot: true,
      waivedByUserId: actorUserId,
      flag: 'yellow',
      flagReason: '商户已免提交付款凭证',
    });

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'merchant_waive_append_batch_screenshot',
      timestamp: Timestamp.now(),
      userId: actorUserId,
      note: appendBatchId,
    });

    tx.update(orderRef, {
      paymentScreenshots: prevShots,
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });
  });
}

/** 一次性确认当前所有「待核实」加购补款（多档待确认时一并入账） */
export async function merchantConfirmPendingAppendBatches(
  orderFirestoreId: string,
  actorUserId: string,
  options?: { includeInitialPayment?: boolean }
): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);

  if (
    pre.status !== 'partial_paid' &&
    pre.status !== 'pending' &&
    pre.status !== 'unpaid'
  ) {
    throw new Error('当前没有待确认的加购补款');
  }

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (
      o.status !== 'partial_paid' &&
      o.status !== 'pending' &&
      o.status !== 'unpaid'
    ) {
      throw new Error('订单状态已变更，请刷新后重试');
    }

    const projectRef = doc(db, 'projects', o.projectId);
    const pSnap = await tx.get(projectRef);
    if (!pSnap.exists()) throw new Error('项目不存在');
    const project = pSnap.data() as ProjectDoc;
    if (project.shopId !== o.shopId) throw new Error('数据不一致');

    const batches = [...(o.appendBatches ?? [])];
    const pending = batches.filter((b) => !b.confirmedAt);
    if (pending.length === 0) {
      throw new Error('没有待确认的加购补款');
    }
    const pendingIds = pending.map((b) => b.id);

    if (
      !canMerchantConfirmPendingAppendLump(
        o.paymentScreenshots,
        pending.map((b) => ({ id: b.id, appendedAt: b.appendedAt }))
      )
    ) {
      throw new Error('加购补款尚未上传对应付款截图，请待顾客提交后再确认');
    }

    const supplement = pending.reduce(
      (s, b) => s + (Number(b.deltaAmount) || 0),
      0
    );
    if (supplement <= 0) throw new Error('加购金额无效');

    const now = Timestamp.now();
    const includeInitial = options?.includeInitialPayment === true;
    const confirmInitialInSameAction = includeInitial && !o.initialPaymentConfirmedAt;
    const initialSupplement = confirmInitialInSameAction
      ? Math.max(0, computeFirstTrancheAmount(o))
      : 0;
    const newBatches = batches.map((b) => {
      if (!b.confirmedAt && pendingIds.includes(b.id)) {
        return {
          ...b,
          confirmedAt: now,
          confirmedByUserId: actorUserId,
        };
      }
      return b;
    });

    const paidBefore = Number(o.paidAmount) || 0;
    const newPaid = paidBefore + supplement + initialSupplement;
    const newPending = Math.max(0, (Number(o.totalAmount) || 0) - newPaid);
    const nextStatus: OrderStatus =
      newPending <= 0.001 ? 'confirmed' : 'partial_paid';

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'confirm_pending_append_batches',
      timestamp: now,
      userId: actorUserId,
      note: pendingIds.join(','),
    });
    if (confirmInitialInSameAction && initialSupplement > 0.001) {
      history.push({
        action: 'confirm_initial_payment',
        timestamp: now,
        userId: actorUserId,
        note: `merged_with_pending_append=${pendingIds.join(',')};initial=${initialSupplement.toFixed(2)}`,
      });
    }

    const prevStats = project.stats ?? {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    };

    tx.update(orderRef, {
      appendBatches: newBatches,
      paidAmount: newPaid,
      pendingAmount: newPending,
      status: nextStatus,
      ...(confirmInitialInSameAction
        ? { initialPaymentConfirmedAt: now }
        : {}),
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      stats: {
        ...prevStats,
        confirmedRevenue:
          (prevStats.confirmedRevenue ?? 0) + supplement + initialSupplement,
        ...(confirmInitialInSameAction
          ? { unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1) }
          : {}),
        ...(nextStatus === 'confirmed'
          ? { confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1 }
          : {}),
      },
      updatedAt: serverTimestamp(),
    });
  });
}

/** 商户/管理员免核验：强制确认订单里所有待确认组（用于异常兜底入账） */
export async function merchantForceConfirmAllPendingGroups(
  orderFirestoreId: string,
  actorUserId: string
): Promise<void> {
  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const preSnap = await getDoc(orderRef);
  if (!preSnap.exists()) throw new Error('订单不存在');
  const pre = preSnap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, pre);

  if (pre.status === 'cancelled') throw new Error('订单已取消');
  if (pre.status === 'confirmed') throw new Error('订单已全部确认，无需免核验');

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (o.status === 'cancelled') throw new Error('订单已取消');
    if (o.status === 'confirmed') throw new Error('订单已全部确认，无需免核验');

    const projectRef = doc(db, 'projects', o.projectId);
    const pSnap = await tx.get(projectRef);
    if (!pSnap.exists()) throw new Error('项目不存在');
    const project = pSnap.data() as ProjectDoc;
    if (project.shopId !== o.shopId) throw new Error('数据不一致');

    const now = Timestamp.now();
    const appendBatches = (o.appendBatches ?? []).map((b) =>
      b.confirmedAt
        ? b
        : {
            ...b,
            confirmedAt: now,
            confirmedByUserId: actorUserId,
          }
    );

    const totalAmt = Number(o.totalAmount) || 0;
    const paidBefore = Number(o.paidAmount) || 0;
    const deltaConfirmedRevenue = Math.max(0, totalAmt - paidBefore);

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'force_confirm_all_pending_groups',
      timestamp: now,
      userId: actorUserId,
    });

    tx.update(orderRef, {
      status: 'confirmed',
      paidAmount: totalAmt,
      pendingAmount: 0,
      appendBatches,
      initialPaymentConfirmedAt: o.initialPaymentConfirmedAt ?? now,
      statusHistory: history,
      updatedAt: serverTimestamp(),
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
        ...(o.status === 'unpaid' || o.status === 'pending'
          ? { unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1) }
          : {}),
        confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1,
        confirmedRevenue:
          (prevStats.confirmedRevenue ?? 0) + deltaConfirmedRevenue,
      },
      updatedAt: serverTimestamp(),
    });
  });
}

export type MerchantInternalNote = {
  body: string;
  userId: string;
  createdAt: Timestamp;
};

/** 商户内部备注（顾客不可见） */
export async function merchantAppendInternalNote(
  orderFirestoreId: string,
  actorUserId: string,
  body: string
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('备注不能为空');

  const db = getDb();
  const orderRef = doc(db, 'orders', orderFirestoreId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('订单不存在');
  const order = snap.data() as OrderDoc;
  await assertMerchantCanManageOrder(actorUserId, order);

  const prev = Array.isArray(order.internalNotes)
    ? [...order.internalNotes]
    : [];
  const entry: MerchantInternalNote = {
    body: trimmed,
    userId: actorUserId,
    createdAt: Timestamp.now(),
  };
  prev.push(entry);

  await updateDoc(orderRef, {
    internalNotes: prev,
    updatedAt: serverTimestamp(),
  });
}
