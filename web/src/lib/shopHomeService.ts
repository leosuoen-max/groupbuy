import type { Timestamp } from 'firebase/firestore';
import { getProject } from './projectService';
import { getShopBySlug } from './shopService';
import type {
  MockBundleTool,
  MockImageBlock,
  MockProduct,
  MockShopHome,
  ProjectStatus,
} from '../data/mockShopHome';
import type { ProjectDoc, ProjectProduct } from '../types/firestore';

export type ShopHomeLoadError =
  | 'SHOP_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_WRONG_SHOP'
  | 'PROJECT_DRAFT';

const ERROR_MESSAGES: Record<ShopHomeLoadError, string> = {
  SHOP_NOT_FOUND: '找不到该店铺链接，请核对网址。',
  PROJECT_NOT_FOUND: '找不到该团购项目，可能已删除或链接有误。',
  PROJECT_WRONG_SHOP: '项目与店铺不匹配。',
  PROJECT_DRAFT: '该项目尚未发布，暂不可访问。',
};

export function shopHomeErrorMessage(code: ShopHomeLoadError): string {
  return ERROR_MESSAGES[code];
}


function tsToIso(t: Timestamp | null | undefined): string | undefined {
  if (!t || typeof (t as Timestamp).toDate !== 'function') return undefined;
  return (t as Timestamp).toDate().toISOString();
}

function mapProduct(p: ProjectProduct): MockProduct {
  return {
    id: p.id,
    name: p.name,
    note: p.description,
    sortOrder: p.sortOrder ?? 0,
    price: p.price,
    discountPrice: p.discountPrice,
    discountStart: tsToIso(p.discountStart ?? undefined),
    discountEnd: tsToIso(p.discountEnd ?? undefined),
    stock: p.stock,
    imageUrl: p.imageUrl,
    isActive: p.isActive,
  };
}

function mapImageBlocks(
  blocks: ProjectDoc['imageBlocks'] | undefined
): MockImageBlock[] {
  if (!blocks?.length) return [];
  return blocks.map((b) => ({ url: b.url, caption: b.caption }));
}

function mapBundleTools(tools: ProjectDoc['bundleTools'] | undefined): MockBundleTool[] {
  if (!tools?.length) return [];
  return tools.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isActive: t.isActive,
    sortOrder: t.sortOrder ?? 0,
    series: t.series
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        options: s.options
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((o) => ({
            id: o.id,
            name: o.name,
            note: o.note,
            imageUrl: o.imageUrl,
            stock: o.stock,
            isActive: o.isActive,
          })),
      })),
    schemes: t.schemes
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({
        id: x.id,
        name: x.name,
        price: x.price,
        discountPrice: x.discountPrice,
        discountStart: tsToIso(x.discountStart ?? undefined),
        discountEnd: tsToIso(x.discountEnd ?? undefined),
        requirements: x.requirements,
        isActive: x.isActive,
      })),
  }));
}

function resolveUiStatus(
  project: ProjectDoc,
  now: Date
): ProjectStatus {
  if (project.status === 'closed') return 'closed';
  const closes = project.closesAt?.toDate?.() ?? null;
  if (closes && now.getTime() > closes.getTime()) return 'closed';

  const max = project.maxParticipants;
  if (max != null && max > 0) {
    const cur = project.stats?.totalOrders ?? 0;
    if (cur >= max) return 'full';
  }

  return 'open';
}

/**
 * 顾客端：按 slug + projectId 拉取店铺与项目，并映射为 ShopHome 展示结构。
 * 仅拦截草稿项目；已发布与已截止项目均可访问（符合需求文档）。
 */
export async function loadShopHomeFromFirestore(
  shopSlug: string,
  projectId: string,
  now: Date = new Date()
): Promise<{ ok: true; data: MockShopHome } | { ok: false; code: ShopHomeLoadError }> {
  const slug = shopSlug.trim();
  const pid = projectId.trim();
  if (!slug || !pid) {
    return { ok: false, code: 'SHOP_NOT_FOUND' };
  }

  const shopRow = await getShopBySlug(slug);
  if (!shopRow) return { ok: false, code: 'SHOP_NOT_FOUND' };

  const shop = shopRow.data;

  const projectRow = await getProject(pid);
  if (!projectRow) return { ok: false, code: 'PROJECT_NOT_FOUND' };

  const proj = projectRow.data;
  if (proj.shopId !== shopRow.id) {
    return { ok: false, code: 'PROJECT_WRONG_SHOP' };
  }
  if (proj.status === 'draft') {
    return { ok: false, code: 'PROJECT_DRAFT' };
  }

  const products = [...(proj.products ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(mapProduct);

  const closesAt = proj.closesAt?.toDate?.()?.toISOString() ?? new Date().toISOString();
  const bannerUrl = shop.bannerImage?.trim() || undefined;
  const orderCount = proj.stats?.totalOrders ?? 0;
  const deliveryLabel =
    proj.deliveryPointIds?.length > 0 ? '按配送点' : '待定 / 请见说明';

  const data: MockShopHome = {
    shopName: shop.name,
    projectTitle: proj.title,
    bannerUrl,
    themeColor: shop.themeColor || '#E63946',
    status: resolveUiStatus(proj, now),
    closesAt,
    orderCount,
    deliveryLabel,
    textContent: proj.textContent?.trim() || undefined,
    imageBlocks: mapImageBlocks(proj.imageBlocks),
    products,
    bundleTools: mapBundleTools(proj.bundleTools),
  };

  return { ok: true, data };
}
