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
  /** 是否已开通「大马饭团」发布能力；未设置按 false 处理 */
  feituanEnabled?: boolean;
};

export type ProjectProduct = {
  id: string;
  name: string;
  description?: string;
  /** 商户录入：单品采购成本（RM），用于对账单利润统计 */
  purchaseCost?: number;
  price: number;
  discountPrice?: number;
  discountStart?: Timestamp | null;
  discountEnd?: Timestamp | null;
  stock: number;
  imageUrl?: string;
  isActive: boolean;
  sortOrder: number;
  /** 到达该时间后自动视为下架（顾客端不可购）；未设置则无定时下架 */
  scheduledOffAt?: Timestamp | null;
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
  /** 商户备注（可与产品库「备注」对应；顾客端可选展示） */
  note?: string;
  /** 商户录入：该套餐方案采购成本（RM），用于对账单利润统计 */
  purchaseCost?: number;
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
  /** 到达该时刻后自动视为下架（顾客端不可购） */
  scheduledOffAt?: Timestamp | null;
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
  /** 大马饭团发布/审核状态；未设置表示从未发布到饭团 */
  feituanStatus?: 'pending' | 'listed' | 'rejected' | 'delisted';
  feituanSubmittedAt?: Timestamp | null;
  feituanReviewedAt?: Timestamp | null;
  feituanReviewedBy?: string;
  feituanRejectReason?: string;
  feituanChangeLog?: {
    at: Timestamp;
    by: string;
    action: 'submit' | 'approve' | 'reject' | 'delist';
    note?: string;
  }[];
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

/** 登录/注册用户在平台上的登记快照（`registered_users/{uid}`） */
export type RegisteredUserDoc = {
  uid: string;
  /** 掩码展示，如 ****5678；匿名用户为 null */
  phoneMasked: string | null;
  isAnonymous: boolean;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
};

/** 平台后台管理员白名单（`platform_admins/{uid}`，控制台手动创建文档即可） */
export type PlatformAdminDoc = {
  note?: string;
  createdAt?: Timestamp;
};

/* ----------------------------- 优惠卡（钱包 / 次卡） ----------------------------- */

export type CardType = 'stored' | 'pass';

/**
 * 店铺级产品库：同名（规范化后）同类型内唯一，用于项目编辑时快速选用。
 * - product：普通商品
 * - bundle_scheme：套餐方案
 * - bundle_option：套餐系列内的品项（选项名、图、备注；无单价时 retailPrice 存 0）
 */
export type ProductLibraryKind = 'product' | 'bundle_scheme' | 'bundle_option';

export type ProductLibraryItemDoc = {
  shopId: string;
  ownerId: string;
  /** 去重键：trim + 连续空白归一 + 小写 */
  nameKey: string;
  /** 展示名称 */
  name: string;
  imageUrl?: string;
  purchaseCost?: number;
  /** 零售价 (RM) */
  retailPrice: number;
  note?: string;
  kind: ProductLibraryKind;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

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

export type OrderChannel = 'shop' | 'feituan';

/** 单次钱包/次卡结算快照（一笔对应一次支付动作、一组清偿） */
export type OrderCardPaymentDoc = {
  /** 本次清偿涵盖的分段（与支付组对齐）；旧数据可能缺失 */
  cardSettlementScope?: {
    /** 本次是否清偿首单段 */
    includesInitialSegment: boolean;
    /** 本次自动确认的加购批次 id */
    confirmedAppendBatchIds: string[];
  };
  wallet?: {
    customerCardId: string;
    templateId: string;
    deduct: number;
    ledgerId: string;
  };
  passCards: Array<{
    customerCardId: string;
    templateId: string;
    uses: number;
    appliedLineProductIds: string[];
    ledgerId: string;
  }>;
  /** 本次结算卡侧抵扣总金额 */
  totalDeducted: number;
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
  /** 订单入口渠道；旧订单缺省视为 shop */
  channel?: OrderChannel;
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
  /** 每次卡支付一条，按时间追加；与支付组一一留痕，参见 orderCardPaymentApplications */
  cardPaymentApplications?: OrderCardPaymentDoc[];
  /**
   * @deprecated 仅旧订单单笔卡支付；新订单请用 cardPaymentApplications + listOrderCardPaymentApplications
   */
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
