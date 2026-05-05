import type { Timestamp } from 'firebase/firestore';

export type ShopDoc = {
  slug: string;
  name: string;
  ownerId: string;
  themeColor: string;
  /** 顾客端抬头横幅，见 docs/06 */
  bannerImage?: string;
  paymentMethods: { id: string; name: string; qrCodeUrl: string }[];
  settings: { language: 'zh' | 'en' | 'ms'; currency: string };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isActive: boolean;
};

export type ProjectProduct = {
  id: string;
  name: string;
  description?: string;
  price: number;
  discountPrice?: number;
  discountStart?: Timestamp | null;
  discountEnd?: Timestamp | null;
  stock: number;
  imageUrl?: string;
  isActive: boolean;
  sortOrder: number;
};

export type ProjectDoc = {
  shopId: string;
  title: string;
  status: 'draft' | 'published' | 'closed';
  closesAt: Timestamp;
  maxParticipants?: number | null;
  textContent?: string;
  imageBlocks?: {
    url: string;
    caption?: string;
    isCoverImage: boolean;
  }[];
  products: ProjectProduct[];
  deliveryPointIds: string[];
  formFields: {
    name: { required: boolean };
    phone: { required: boolean };
    address: { required: boolean };
    note: { required: boolean };
  };
  orderSettings: {
    maxOrdersPerCustomer: number | null;
    visibility: 'all' | 'self' | 'merchant';
    allowEdit: boolean;
    allowCancel: boolean;
  };
  stats: {
    totalOrders: number;
    confirmedOrders: number;
    pendingOrders: number;
    unpaidOrders: number;
    totalRevenue: number;
    confirmedRevenue: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  publishedAt?: Timestamp | null;
};

export type PermissionDoc = {
  userId: string;
  projectId: string;
  scope: 'shop' | 'project';
  scopeId: string;
  role: 'owner' | 'high_admin' | 'normal_admin';
  grantedBy: string;
  grantedAt: Timestamp;
  invitationId?: string;
};

export type InvitationDoc = {
  code: string;
  shopId?: string;
  projectId?: string;
  scope: 'shop' | 'project';
  role: 'high_admin' | 'normal_admin';
  invitedBy: string;
  expiresAt: Timestamp;
  usedAt?: Timestamp | null;
  usedBy?: string | null;
  createdAt: Timestamp;
};

export type DeliveryPointDoc = {
  shopId: string;
  number: number;
  name: string;
  detailAddress?: string;
  deliveryTime?: string;
  imageUrl?: string;
  keywords?: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type OrderStatus =
  | 'unpaid'
  | 'pending'
  | 'confirmed'
  | 'partial_paid'
  | 'cancelled';

export type OrderLineDoc = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isDiscount: boolean;
  subtotal: number;
};

/** 顾客每次「加菜」产生一档记录，便于商户分笔核对补款 */
export type OrderAppendBatchDoc = {
  id: string;
  appendedAt: Timestamp;
  lines: OrderLineDoc[];
  deltaAmount: number;
  confirmedAt?: Timestamp;
  confirmedByUserId?: string;
};

export type OrderDoc = {
  orderNumber: string;
  shopId: string;
  shopSlug: string;
  projectId: string;
  projectTitle: string;
  customerKey: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNote?: string;
  lines: OrderLineDoc[];
  /** 首单明细快照（与 lines 在首次下单时一致；加菜后 lines 为合并结果） */
  initialLines?: OrderLineDoc[];
  initialTotalAmount?: number;
  /** 每次加购一档；首单不含在内 */
  appendBatches?: OrderAppendBatchDoc[];
  /** 首笔全款由商户确认的时间（用于界面区分「首单已付」） */
  initialPaymentConfirmedAt?: Timestamp;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  deliveryPointId?: string;
  deliveryPointSnapshot: {
    name: string;
    detail?: string;
  };
  isManualMatch: boolean;
  paymentScreenshots: unknown[];
  status: OrderStatus;
  internalNotes: unknown[];
  statusHistory: {
    action: string;
    timestamp: Timestamp;
    userId?: string;
    note?: string;
  }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
