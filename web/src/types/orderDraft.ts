export type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isDiscount: boolean;
};

export type CartLocationState = {
  lines?: OrderLine[] | null;
  projectTitle?: string;
  /** 选菜页草稿数量，支持从订单页返回继续修改 */
  cartDraft?: Record<string, number>;
};

export type MockDeliveryPoint = {
  id: string;
  name: string;
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
