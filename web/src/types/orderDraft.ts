export type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isDiscount: boolean;
  /** 限时优惠（早鸟）的截止时间，仅用于下单后付款时限判断 */
  discountEndsAt?: string;
};

export type CartLocationState = {
  lines?: OrderLine[] | null;
  bundleSelections?: BundleSelectionDraft[] | null;
  projectTitle?: string;
  /** 选菜页草稿数量，支持从订单页返回继续修改 */
  cartDraft?: Record<string, number>;
};

export type BundleSelectionDraft = {
  bundleToolId: string;
  schemeId: string;
  /** key=seriesId, value=selected option ids */
  selectedOptionIdsBySeries: Record<string, string[]>;
  quantity: number;
  unitPrice: number;
  isDiscount?: boolean;
  discountEndsAt?: string;
  label: string;
};

export type MockDeliveryPoint = {
  id: string;
  /** 简称（展示） */
  name: string;
  /** 配送点编号，如 A1 */
  code?: string;
  /** 饭团配送区归属；商户自有配送点可为空 */
  zoneId?: string;
  zoneName?: string;
  detailAddress?: string;
  deliveryTime?: string;
  imageUrl?: string;
};

export type StoredMockOrder = {
  orderNumber: string;
  projectId: string;
  shopSlug: string;
  projectTitle: string;
  createdAt: string;
  status: 'unpaid';
  lines: OrderLine[];
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNote?: string;
  deliveryPointId: string;
  deliveryPointLabel: string;
  isManualMatch: boolean;
  totalAmount: number;
};
