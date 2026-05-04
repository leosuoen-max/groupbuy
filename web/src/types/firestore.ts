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
