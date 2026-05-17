import type { Timestamp } from 'firebase/firestore';
import type { BundleSelectionDraft, OrderLine } from '../types/orderDraft';
import type { BundleSchemeDoc, ProjectDoc, ProjectProduct } from '../types/firestore';
import type { ProjectRow } from './projectService';
import {
  isBundleToolPastScheduledOff,
  isProjectProductSellable,
} from './productAvailability';

type PriceInfo = {
  unit: number;
  isDiscount: boolean;
  discountType?: 'special' | 'earlybird';
  discountEndsAt?: string;
};

function tsToDate(t: Timestamp | null | undefined): Date | null {
  return t?.toDate ? t.toDate() : null;
}

export function effectiveProductPrice(p: ProjectProduct, now: Date): PriceInfo {
  const price = Number(p.price) || 0;
  const discount = p.discountPrice == null ? null : Number(p.discountPrice);
  if (discount == null || Number.isNaN(discount)) {
    return { unit: price, isDiscount: false };
  }
  const end = tsToDate(p.discountEnd);
  if (end) {
    const start = tsToDate(p.discountStart);
    const inWindow = now <= end && (!start || now >= start);
    if (!inWindow) return { unit: price, isDiscount: false };
    return {
      unit: discount,
      isDiscount: true,
      discountType: 'earlybird',
      discountEndsAt: end.toISOString(),
    };
  }
  return { unit: discount, isDiscount: true, discountType: 'special' };
}

export function effectiveSchemePrice(scheme: BundleSchemeDoc, now: Date): PriceInfo {
  const price = Number(scheme.price) || 0;
  const discount = scheme.discountPrice == null ? null : Number(scheme.discountPrice);
  if (discount == null || Number.isNaN(discount)) {
    return { unit: price, isDiscount: false };
  }
  const end = tsToDate(scheme.discountEnd);
  if (end) {
    const start = tsToDate(scheme.discountStart);
    const inWindow = now <= end && (!start || now >= start);
    if (!inWindow) return { unit: price, isDiscount: false };
    return {
      unit: discount,
      isDiscount: true,
      discountType: 'earlybird',
      discountEndsAt: end.toISOString(),
    };
  }
  return { unit: discount, isDiscount: true, discountType: 'special' };
}

function getSeriesRequiredCount(
  requirements: Record<string, number> | undefined,
  series: { id: string; code?: string; name?: string }
): number {
  if (!requirements) return 0;
  const byId = Number(requirements[series.id] ?? 0);
  if (byId > 0) return byId;
  const code = series.code?.trim();
  if (code) {
    const byCode = Number(requirements[code] ?? 0);
    if (byCode > 0) return byCode;
  }
  const name = series.name?.trim();
  if (name) {
    const byName = Number(requirements[name] ?? 0);
    if (byName > 0) return byName;
  }
  return 0;
}

export type BuiltCartLines = {
  lines: OrderLine[];
  bundleSelections: BundleSelectionDraft[];
  subtotal: number;
};

export function buildLinesFromCartDraft(
  project: ProjectDoc,
  cartDraft: Record<string, number>,
  bundleSelections: BundleSelectionDraft[],
  now: Date = new Date()
): BuiltCartLines {
  const sellable = [...(project.products ?? [])].filter((p) =>
    isProjectProductSellable(p, now)
  );

  const normalLines: OrderLine[] = sellable
    .map((p) => {
      const q = cartDraft[p.id] ?? 0;
      if (q <= 0) return null;
      const price = effectiveProductPrice(p, now);
      return {
        productId: p.id,
        name: p.name,
        quantity: q,
        unitPrice: price.unit,
        isDiscount: price.isDiscount,
        ...(price.discountEndsAt ? { discountEndsAt: price.discountEndsAt } : {}),
      } satisfies OrderLine;
    })
    .filter((x): x is OrderLine => Boolean(x));

  const bundleLines: OrderLine[] = bundleSelections.map((x, idx) => ({
    productId: `bundle:${x.bundleToolId}:${x.schemeId}:${idx}`,
    name: x.label,
    quantity: x.quantity,
    unitPrice: x.unitPrice,
    isDiscount: x.isDiscount ?? false,
    ...(x.discountEndsAt ? { discountEndsAt: x.discountEndsAt } : {}),
  }));

  const lines = [...normalLines, ...bundleLines];
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  return { lines, bundleSelections, subtotal };
}

export type CartProjectValidation = {
  ok: boolean;
  reason?: 'closed' | 'not_listed' | 'empty' | 'stock' | 'inactive';
  message: string;
};

export function validateProjectRowForCart(
  row: ProjectRow,
  lines: OrderLine[],
  bundleSelections: BundleSelectionDraft[],
  now: Date = new Date()
): CartProjectValidation {
  const p = row.data;
  if (p.feituanStatus !== 'listed') {
    return { ok: false, reason: 'not_listed', message: '项目未上架' };
  }
  if (p.status === 'draft' || p.status === 'closed') {
    return { ok: false, reason: 'closed', message: '项目已截止或未发布' };
  }
  const closes = p.closesAt?.toDate?.();
  if (closes && closes.getTime() <= now.getTime()) {
    return { ok: false, reason: 'closed', message: '已过截单时间' };
  }
  if (!lines.length) {
    return { ok: false, reason: 'empty', message: '无有效商品' };
  }

  for (const line of lines) {
    if (line.productId.startsWith('bundle:')) continue;
    const product = p.products?.find((x) => x.id === line.productId);
    if (!product || !isProjectProductSellable(product, now)) {
      return { ok: false, reason: 'inactive', message: '有商品已下架' };
    }
    if (product.stock < line.quantity) {
      return {
        ok: false,
        reason: 'stock',
        message: `${product.name} 库存不足`,
      };
    }
  }

  for (const sel of bundleSelections) {
    const tool = p.bundleTools?.find((t) => t.id === sel.bundleToolId);
    if (!tool?.isActive || isBundleToolPastScheduledOff(tool, now.getTime())) {
      return { ok: false, reason: 'inactive', message: '套餐已下架' };
    }
    const scheme = tool.schemes.find((s) => s.id === sel.schemeId && s.isActive);
    if (!scheme) {
      return { ok: false, reason: 'inactive', message: '套餐方案不可用' };
    }
    const qty = Math.max(1, sel.quantity);
    for (const series of tool.series) {
      const required = getSeriesRequiredCount(scheme.requirements, series);
      const picked = sel.selectedOptionIdsBySeries?.[series.id] ?? [];
      if (picked.length !== required) {
        return { ok: false, reason: 'inactive', message: '套餐选择不完整' };
      }
      for (const optId of picked) {
        const opt = series.options.find((x) => x.id === optId);
        if (!opt?.isActive || (opt.stock ?? 0) < qty) {
          return { ok: false, reason: 'stock', message: '套餐选项库存不足' };
        }
      }
    }
  }

  return { ok: true, message: '' };
}

export function rebuildBundleSelectionsPrices(
  project: ProjectDoc,
  bundleSelections: BundleSelectionDraft[],
  now: Date = new Date()
): BundleSelectionDraft[] {
  return bundleSelections.map((sel) => {
    const tool = project.bundleTools?.find((t) => t.id === sel.bundleToolId);
    const scheme = tool?.schemes.find((s) => s.id === sel.schemeId);
    if (!scheme) return sel;
    const price = effectiveSchemePrice(scheme, now);
    return {
      ...sel,
      unitPrice: price.unit,
      isDiscount: price.isDiscount,
      ...(price.discountEndsAt ? { discountEndsAt: price.discountEndsAt } : {}),
    };
  });
}
