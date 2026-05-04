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
