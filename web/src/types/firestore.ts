import type { Timestamp } from 'firebase/firestore';

export type ShopDoc = {
  slug: string;
  name: string;
  ownerId: string;
  themeColor: string;
  /** 顾客端抬头横幅，见 docs/06 */
  bannerImage?: string;
  /** 店铺 logo（商户配置用） */
  logoImage?: string;
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
  /** 本商品可被以下次卡模板抵扣（id 列表，对应 CardTemplateDoc.id） */
  applicableCardTemplateIds?: string[];
};

export type BundleSeriesOptionDoc = {
  id: string;
  name: string;
  note?: string;
  imageUrl?: string;
  stock: number;
  isActive: boolean;
  sortOrder: number;
};

export type BundleSeriesDoc = {
  id: string;
  /** 固定编码：A/B/C... */
  code: string;
  name: string;
  options: BundleSeriesOptionDoc[];
  sortOrder: number;
};

export type BundleSchemeDoc = {
  id: string;
  name: string;
  price: number;
  discountPrice?: number;
  discountStart?: Timestamp | null;
  discountEnd?: Timestamp | null;
  /** key=seriesId, value=required count */
  requirements: Record<string, number>;
  isActive: boolean;
  sortOrder: number;
  /** 本方案可被以下次卡模板抵扣（id 列表，对应 CardTemplateDoc.id） */
  applicableCardTemplateIds?: string[];
};

export type BundleToolDoc = {
  id: string;
  name: string;
  /** 套餐说明/备注，显示在套餐名下方 */
  description?: string;
  isActive: boolean;
  sortOrder: number;
  series: BundleSeriesDoc[];
  schemes: BundleSchemeDoc[];
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
  bundleTools?: BundleToolDoc[];
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

/* ----------------------------- 优惠卡（钱包 / 次卡） ----------------------------- */

export type CardType = 'stored' | 'pass';

export type CardTopupRule = {
  /** 顾客实付金额 (RM) */
  pay: number;
  /** 钱包：到账面值；次卡：到账次数 */
  gain: number;
};

/** 商户配置的卡模板：店铺级 */
export type CardTemplateDoc = {
  shopId: string;
  ownerId: string;
  name: string;
  type: CardType;
  /** 钱包：面值（RM）；次卡：可使用次数 */
  faceValueOrUses: number;
  /** 首次购买价格 (RM) */
  salePrice: number;
  /** 有效期（天数）；激活时按此天数生成 validUntil。0 = 不限期 */
  validityDays: number;
  /** 充值/续卡规则（可空） */
  topupRules: CardTopupRule[];
  /** 备注 / 描述（前端展示用） */
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** 顾客拥有的卡实例（一张卡 = 一条记录） */
export type CustomerCardStatus =
  | 'pending'
  | 'active'
  | 'used_up'
  | 'expired'
  | 'cancelled';

export type CustomerCardDoc = {
  shopId: string;
  templateId: string;
  templateNameSnapshot: string;
  type: CardType;
  /** 关联的购卡订单号（首次购买时） */
  purchaseOrderNumber?: string;
  customerKey: string;
  /** 购卡时填写的姓名/电话快照（用于商户对账） */
  customerName?: string;
  customerPhone?: string;
  /** 钱包：剩余面值；次卡：剩余次数 */
  remaining: number;
  /** 累计入账（购卡 + 充值），方便统计 */
  totalIn: number;
  /** 累计扣减（订单使用 + 退款回滚不计入） */
  totalOut: number;
  status: CustomerCardStatus;
  /** 激活时间（商户确认到账） */
  activatedAt?: Timestamp | null;
  /** 失效时间；null 表示永久 */
  validUntil?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** 卡的资金/次数变动流水 */
export type CardLedgerType =
  | 'purchase'
  | 'topup'
  | 'use'
  | 'refund'
  | 'expire';

/** 顾客购卡 / 充值请求（含付款截图，等商户确认） */
export type CardPurchaseRequestStatus = 'pending' | 'confirmed' | 'rejected';
export type CardPurchaseRequestKind = 'purchase' | 'topup';

export type CardPurchaseRequestDoc = {
  shopId: string;
  templateId: string;
  /** 充值时关联到具体的卡实例，新购则为空 */
  customerCardId?: string;
  kind: CardPurchaseRequestKind;
  customerKey: string;
  customerName?: string;
  customerPhone?: string;
  /** 顾客实付金额 (RM) */
  payAmount: number;
  /** 到账值：钱包=面值；次卡=次数 */
  gainValue: number;
  paymentScreenshots: {
    url: string;
    uploadedAt: Timestamp;
    /** 上传时计算的 SHA-256（十六进制），用于跨请求重复识别 */
    contentSha256?: string;
    /** 本店其它购卡/充值请求已使用过相同文件 */
    duplicateRisk?: boolean;
    /** 与本截图哈希相同的其它请求文档 ID（不含当前请求） */
    duplicateMatchRequestIds?: string[];
  }[];
  status: CardPurchaseRequestStatus;
  rejectReason?: string;
  templateNameSnapshot: string;
  templateTypeSnapshot: CardType;
  confirmedAt?: Timestamp;
  confirmedByUserId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CardLedgerDoc = {
  shopId: string;
  customerCardId: string;
  templateId: string;
  customerKey: string;
  type: CardLedgerType;
  /** 变动量：入账正数，出账负数 */
  delta: number;
  /** 变动后剩余 */
  remainingAfter: number;
  /** 关联订单 ID（订单文档 ID，用于跳转） */
  orderId?: string;
  /** 关联订单号（购卡 / 使用 / 退款时） */
  orderNumber?: string;
  /** 关联订单的项目 ID（用于商户后台跳转 /order/:projectId/:orderNumber） */
  orderProjectId?: string;
  /** 关联订单的店铺 slug（同上） */
  orderShopSlug?: string;
  /** 关联订单中具体哪几行被抵扣（次卡使用时） */
  orderLineIds?: string[];
  note?: string;
  createdAt: Timestamp;
};

export type DeliveryPointDoc = {
  /** 新口径：账号级共享库归属 */
  ownerId?: string;
  /** 旧口径（兼容历史数据）：店铺级归属 */
  shopId?: string;
  /** 配送点编号：1-2 位字母 + 1-2 位数字，如 A1 / AB12 */
  code?: string;
  /** 简称（新字段） */
  shortName?: string;
  /** 兼容旧字段（等价于 shortName） */
  name: string;
  /** 兼容旧排序字段 */
  number?: number;
  detailAddress?: string;
  /** Google Maps 链接（选填） */
  mapsUrl?: string;
  imageUrl?: string;
  keywords?: string[];
  isActive: boolean;
  sortOrder?: number;
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
  discountEndsAt?: string;
  subtotal: number;
  /** 本行被次卡抵扣的份数（quantity 中的多少份已用次卡覆盖） */
  cardCoveredQuantity?: number;
};

/** 卡支付汇总（订单上） */
export type OrderCardPaymentDoc = {
  /** 钱包抵扣（可能不存在） */
  wallet?: {
    customerCardId: string;
    templateId: string;
    deduct: number;
    ledgerId: string;
  };
  /** 次卡抵扣分配 */
  passCards: Array<{
    customerCardId: string;
    templateId: string;
    /** 用了多少次 */
    uses: number;
    /** 命中的订单行 productId（可重复） */
    appliedLineProductIds: string[];
    ledgerId: string;
  }>;
  /** 卡侧抵扣总金额 = wallet.deduct + Σ(pass.uses × 该行 unitPrice) */
  totalDeducted: number;
  /** 抵扣发生时间 */
  appliedAt: Timestamp;
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
  /** 若订单包含限时优惠，则顾客需在该时间前完成付款（超时自动作废） */
  timedPromoPaymentDueAt?: Timestamp | null;
  timedPromoWindowMinutes?: number | null;
  deliveryPointId?: string;
  deliveryPointSnapshot: {
    name: string;
    detail?: string;
  };
  isManualMatch: boolean;
  paymentScreenshots: unknown[];
  /** 已应用的卡支付（钱包+次卡）；自动取消时回滚以此为依据 */
  cardPayment?: OrderCardPaymentDoc;
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
