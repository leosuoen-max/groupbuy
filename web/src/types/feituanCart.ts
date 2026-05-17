import type { BundleSelectionDraft, OrderLine } from './orderDraft';

/** 饭团购物车中一个项目的快照（localStorage） */
export type FeituanCartProject = {
  projectId: string;
  projectTitle: string;
  shopId: string;
  shopSlug: string;
  shopName: string;
  lines: OrderLine[];
  bundleSelections: BundleSelectionDraft[];
  cartDraft: Record<string, number>;
  /** 加入时的展示小计；结算时按现价重算 */
  subtotal: number;
  addedAt: number;
};

export type FeituanCart = {
  projects: FeituanCartProject[];
  lastUpdated: number;
};
