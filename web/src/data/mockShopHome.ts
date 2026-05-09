/** 顾客端 ShopHome 用 mock；后续接 Firestore 替换 */

export type ProjectStatus = 'open' | 'closed' | 'full';

export type MockProduct = {
  id: string;
  name: string;
  note?: string;
  sortOrder?: number;
  price: number;
  discountPrice?: number;
  discountStart?: string;
  discountEnd?: string;
  stock: number;
  imageUrl?: string;
  isActive: boolean;
};

export type MockImageBlock = {
  url: string;
  caption?: string;
};

export type MockBundleSeriesOption = {
  id: string;
  name: string;
  note?: string;
  imageUrl?: string;
  stock: number;
  isActive: boolean;
};

export type MockBundleSeries = {
  id: string;
  code: string;
  name: string;
  options: MockBundleSeriesOption[];
};

export type MockBundleScheme = {
  id: string;
  name: string;
  price: number;
  discountPrice?: number;
  discountStart?: string;
  discountEnd?: string;
  requirements: Record<string, number>;
  isActive: boolean;
};

export type MockBundleTool = {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  sortOrder?: number;
  series: MockBundleSeries[];
  schemes: MockBundleScheme[];
};

export type MockShopHome = {
  shopName: string;
  /** 店铺头像 / Logo（商户设置 logoImage） */
  shopLogoUrl?: string;
  /** 项目标题，用于订单展示 */
  projectTitle: string;
  bannerUrl?: string;
  themeColor: string;
  status: ProjectStatus;
  closesAt: string;
  orderCount: number;
  deliveryLabel: string;
  textContent?: string;
  imageBlocks: MockImageBlock[];
  products: MockProduct[];
  bundleTools?: MockBundleTool[];
};

export function getMockShopHome(
  _shopSlug: string | undefined,
  _projectId: string | undefined
): MockShopHome {
  void _shopSlug;
  void _projectId;
  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return {
    shopName: '辉姐家常小厨',
    shopLogoUrl: undefined,
    projectTitle: '5/4 晚餐',
    bannerUrl: undefined,
    themeColor: '#E63946',
    status: 'open',
    closesAt: soon,
    orderCount: 13,
    deliveryLabel: '自取 / 送',
    textContent:
      '今日晚餐 · 东北家常菜\n' +
      '截单后现做，约 18:30 起按配送点送达。\n' +
      '付款请备注订单号，上传付款截图以便核对。',
    imageBlocks: [
      {
        url: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80',
        caption: '今日例汤 · 番茄蛋花汤 RM 6.0',
      },
      {
        url: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=800&q=80',
        caption: '小炒黄牛肉 · RM 22.0',
      },
    ],
    products: [
      {
        id: 'p1',
        name: '晚餐套餐 · 1 荤 1 素',
        note: '含一份米饭，可选两素',
        price: 14.8,
        discountPrice: 10.8,
        discountStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        discountEnd: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        stock: 48,
        imageUrl:
          'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=200&q=80',
        isActive: true,
      },
      {
        id: 'p2',
        name: '米饭（加购）',
        note: undefined,
        price: 2.0,
        stock: 80,
        isActive: true,
      },
      {
        id: 'p3',
        name: '今日隐藏款 · 酱大骨',
        note: '数量有限',
        price: 18.0,
        stock: 0,
        imageUrl:
          'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=200&q=80',
        isActive: true,
      },
      {
        id: 'p4',
        name: '已下架示例（不应显示）',
        price: 1,
        stock: 99,
        isActive: false,
      },
    ],
  };
}
