import {
  collection,
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
import { getProjectPermissionForUser } from './permissionService';
import { getShopById } from './shopService';
import type { OrderLine } from '../types/orderDraft';
import type { OrderDoc, OrderLineDoc, OrderStatus, ProjectDoc } from '../types/firestore';

export type OrderRow = { id: string; data: OrderDoc };

export type CreateOrderInput = {
  shopSlug: string;
  projectId: string;
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
};

type CreateOrderErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_NOT_PUBLISHED'
  | 'PROJECT_CLOSED'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_INACTIVE'
  | 'INSUFFICIENT_STOCK';

const CREATE_ORDER_ERROR_MESSAGE: Record<CreateOrderErrorCode, string> = {
  PROJECT_NOT_FOUND: '项目不存在或已删除。',
  PROJECT_NOT_PUBLISHED: '项目尚未发布，暂不能下单。',
  PROJECT_CLOSED: '项目已截止，暂不能下单。',
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
    subtotal: l.quantity * l.unitPrice,
  }));
}

function computeTotal(lines: OrderLineDoc[]): number {
  return lines.reduce((sum, l) => sum + l.subtotal, 0);
}

function ensureProjectCanOrder(project: ProjectDoc): void {
  if (project.status === 'draft') throw new CreateOrderError('PROJECT_NOT_PUBLISHED');
  const closesAt = project.closesAt?.toDate?.();
  if (project.status === 'closed') throw new CreateOrderError('PROJECT_CLOSED');
  if (closesAt && closesAt.getTime() <= Date.now()) {
    throw new CreateOrderError('PROJECT_CLOSED');
  }
}

function applyStockDeduction(project: ProjectDoc, lines: OrderLine[]): ProjectDoc['products'] {
  const nextProducts = [...(project.products ?? [])].map((p) => ({ ...p }));
  for (const line of lines) {
    const idx = nextProducts.findIndex((p) => p.id === line.productId);
    if (idx < 0) throw new CreateOrderError('PRODUCT_NOT_FOUND');
    const product = nextProducts[idx];
    if (!product.isActive) throw new CreateOrderError('PRODUCT_INACTIVE');
    if (product.stock < line.quantity) throw new CreateOrderError('INSUFFICIENT_STOCK');
    product.stock -= line.quantity;
  }
  return nextProducts;
}

export async function createOrder(input: CreateOrderInput): Promise<{ orderId: string; orderNumber: string }> {
  const db = getDb();
  const orderRef = doc(collection(db, 'orders'));
  const projectRef = doc(db, 'projects', input.projectId);

  return runTransaction(db, async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists()) throw new CreateOrderError('PROJECT_NOT_FOUND');
    const project = projectSnap.data() as ProjectDoc;

    ensureProjectCanOrder(project);

    const lines = toOrderLines(input.lines);
    const nextProducts = applyStockDeduction(project, input.lines);
    const totalAmount = computeTotal(lines);

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
      shopId: project.shopId,
      shopSlug: input.shopSlug,
      projectId: input.projectId,
      projectTitle: project.title,
      customerKey: input.customerKey,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      lines,
      totalAmount,
      paidAmount: 0,
      pendingAmount: totalAmount,
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
      stats: {
        ...prevStats,
        totalOrders: nextTotalOrders,
        unpaidOrders: (prevStats.unpaidOrders ?? 0) + 1,
        totalRevenue: (prevStats.totalRevenue ?? 0) + totalAmount,
      },
      updatedAt: serverTimestamp(),
    });

    return { orderId: orderRef.id, orderNumber };
  });
}

export async function listOrdersByCustomer(projectId: string, customerKey: string): Promise<OrderRow[]> {
  const db = getDb();
  const q = query(
    collection(db, 'orders'),
    where('projectId', '==', projectId),
    where('customerKey', '==', customerKey)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as OrderDoc }))
    .sort((a, b) => {
      const ta = a.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.data.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
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
  return { id: d.id, data: d.data() as OrderDoc };
}

/** 商户端：按店铺拉取订单（客户端按时间倒序，避免复合索引） */
export async function listOrdersByShopId(shopId: string): Promise<OrderRow[]> {
  const db = getDb();
  const q = query(collection(db, 'orders'), where('shopId', '==', shopId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as OrderDoc }))
    .sort((a, b) => {
      const ta = a.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.data.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
}

async function assertMerchantCanManageOrder(
  actorUserId: string,
  order: OrderDoc
): Promise<void> {
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

/** 商户确认收款：订单改为已确认，并更新项目统计（与下单时的 unpaid 计数对齐） */
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
  if (pre.status !== 'unpaid' && pre.status !== 'pending') {
    throw new Error('当前状态不可确认收款');
  }

  await runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('订单不存在');
    const o = oSnap.data() as OrderDoc;
    if (o.status === 'confirmed') throw new Error('订单状态已变更，请刷新后重试');

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

    const history = [...(o.statusHistory ?? [])];
    history.push({
      action: 'confirm_payment',
      timestamp: Timestamp.now(),
      userId: actorUserId,
    });

    tx.update(orderRef, {
      status: 'confirmed',
      paidAmount: o.totalAmount,
      pendingAmount: 0,
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });

    tx.update(projectRef, {
      stats: {
        ...prevStats,
        confirmedOrders: (prevStats.confirmedOrders ?? 0) + 1,
        unpaidOrders: Math.max(0, (prevStats.unpaidOrders ?? 0) - 1),
        confirmedRevenue: (prevStats.confirmedRevenue ?? 0) + o.totalAmount,
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
