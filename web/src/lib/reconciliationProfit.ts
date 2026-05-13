import type { OrderRow } from './orderService';
import type { OrderLineDoc, ProjectDoc } from '../types/firestore';
import {
  linesInSelectedBuckets,
  listOrderPaymentGroups,
  orderMatchesBucketSelection,
  type BucketSelection,
} from './reconciliationGroups';

/** bundle:toolId:schemeId:idx */
export function parseBundleProductId(
  productId: string
): { toolId: string; schemeId: string } | null {
  if (!productId.startsWith('bundle:')) return null;
  const parts = productId.split(':');
  if (parts.length < 4 || parts[0] !== 'bundle') return null;
  const toolId = parts[1];
  const schemeId = parts[2];
  if (!toolId || !schemeId) return null;
  return { toolId, schemeId };
}

function aggKeyForLine(line: OrderLineDoc): string {
  const b = parseBundleProductId(line.productId);
  if (b) return `bundle:${b.toolId}:${b.schemeId}`;
  return `product:${line.productId}`;
}

type ProjectMenuIndex = {
  productById: Map<string, ProjectDoc['products'][number]>;
  schemeByKey: Map<
    string,
    NonNullable<ProjectDoc['bundleTools']>[number]['schemes'][number]
  >;
};

function bundleKey(toolId: string, schemeId: string): string {
  return `${toolId}:${schemeId}`;
}

function buildProjectMenuIndex(project: ProjectDoc): ProjectMenuIndex {
  const productById = new Map(
    (project.products ?? []).map((product) => [product.id, product] as const)
  );
  const schemeByKey = new Map<
    string,
    NonNullable<ProjectDoc['bundleTools']>[number]['schemes'][number]
  >();
  for (const tool of project.bundleTools ?? []) {
    for (const scheme of tool.schemes) {
      schemeByKey.set(bundleKey(tool.id, scheme.id), scheme);
    }
  }
  return { productById, schemeByKey };
}

function buildProjectMenuIndexes(
  projectsById: Map<string, ProjectDoc>
): Map<string, ProjectMenuIndex> {
  return new Map(
    [...projectsById.entries()].map(([projectId, project]) => [
      projectId,
      buildProjectMenuIndex(project),
    ])
  );
}

function getRetailUnit(index: ProjectMenuIndex, line: OrderLineDoc): number | null {
  const b = parseBundleProductId(line.productId);
  if (!b) {
    const p = index.productById.get(line.productId);
    return p ? Number(p.price) || 0 : null;
  }
  const sch = index.schemeByKey.get(bundleKey(b.toolId, b.schemeId));
  return sch ? Number(sch.price) || 0 : null;
}

function getPurchaseCost(index: ProjectMenuIndex, line: OrderLineDoc): {
  cost: number;
  missing: boolean;
} {
  const b = parseBundleProductId(line.productId);
  if (!b) {
    const p = index.productById.get(line.productId);
    if (!p) return { cost: 0, missing: true };
    const c = p.purchaseCost;
    if (c == null || Number.isNaN(Number(c))) return { cost: 0, missing: true };
    return { cost: Math.max(0, Number(c)), missing: false };
  }
  const sch = index.schemeByKey.get(bundleKey(b.toolId, b.schemeId));
  if (!sch) return { cost: 0, missing: true };
  const c = sch.purchaseCost;
  if (c == null || Number.isNaN(Number(c))) return { cost: 0, missing: true };
  return { cost: Math.max(0, Number(c)), missing: false };
}

export type ProfitAggRow = {
  key: string;
  name: string;
  kind: 'product' | 'scheme';
  quantity: number;
  sales: number;
  cost: number;
  profit: number;
  /** 该行特惠/早鸟等相对当前菜单标价的减免合计（与上方汇总卡片口径一致） */
  discountReduction: number;
};

export type ProfitTotals = {
  rows: ProfitAggRow[];
  totalSales: number;
  totalCost: number;
  grossProfit: number;
  earlyBirdReduction: number;
  specialReduction: number;
  discountReductionTotal: number;
  /** 当前筛选订单里，找不到对应项目文档的次数 */
  missingProjectCount: number;
  /** 明细行中未填写采购成本的计数（按行×数量仍计入销售额，成本按 0） */
  missingCostLineCount: number;
};

/**
 * 按对账单相同筛选：付款组桶 + 订单行 subtotal。
 * 优惠让价：用「当前项目菜单标价 − 实付单价」× 份数，仅当行标记为优惠价且菜单仍能找到标价；早鸟=带 discountEndsAt，否则算特惠。
 */
export function buildProfitTotals(
  rows: OrderRow[],
  bucketSelection: BucketSelection,
  projectsById: Map<string, ProjectDoc>
): ProfitTotals {
  const agg = new Map<
    string,
    {
      name: string;
      kind: 'product' | 'scheme';
      quantity: number;
      sales: number;
      cost: number;
      discountReduction: number;
    }
  >();

  let earlyBirdReduction = 0;
  let specialReduction = 0;
  let missingProjectCount = 0;
  let missingCostLineCount = 0;
  const projectMenuIndexes = buildProjectMenuIndexes(projectsById);

  for (const row of rows) {
    const o = row.data;
    if (o.status === 'cancelled') continue;
    const groups = listOrderPaymentGroups(o);
    if (!orderMatchesBucketSelection(groups, bucketSelection)) continue;

    const projectIndex = projectMenuIndexes.get(o.projectId);
    if (!projectIndex) {
      missingProjectCount += 1;
      continue;
    }

    const scopedLines = linesInSelectedBuckets(groups, bucketSelection);
    for (const line of scopedLines) {
      const qty = Math.max(0, Number(line.quantity) || 0);
      if (qty <= 0) continue;

      const sales = Number(line.subtotal) || 0;
      const { cost: unitCost, missing: costMissing } = getPurchaseCost(
        projectIndex,
        line
      );
      if (costMissing) missingCostLineCount += 1;
      const lineCost = unitCost * qty;

      const key = aggKeyForLine(line);
      const kind = parseBundleProductId(line.productId) ? 'scheme' : 'product';
      const name = (line.name ?? '').trim() || '未命名';

      let lineDiscountReduction = 0;
      if (line.isDiscount) {
        const retail = getRetailUnit(projectIndex, line);
        const unitPaid = Number(line.unitPrice) || 0;
        if (retail != null && retail > unitPaid) {
          lineDiscountReduction = (retail - unitPaid) * qty;
          const early = Boolean(
            typeof line.discountEndsAt === 'string' && line.discountEndsAt.trim().length > 0
          );
          if (early) earlyBirdReduction += lineDiscountReduction;
          else specialReduction += lineDiscountReduction;
        }
      }

      const prev = agg.get(key);
      if (!prev) {
        agg.set(key, {
          name,
          kind,
          quantity: qty,
          sales,
          cost: lineCost,
          discountReduction: lineDiscountReduction,
        });
      } else {
        agg.set(key, {
          name,
          kind,
          quantity: prev.quantity + qty,
          sales: prev.sales + sales,
          cost: prev.cost + lineCost,
          discountReduction: prev.discountReduction + lineDiscountReduction,
        });
      }
    }
  }

  const listRows: ProfitAggRow[] = [...agg.entries()].map(([key, v]) => ({
    key,
    name: v.name,
    kind: v.kind,
    quantity: v.quantity,
    sales: v.sales,
    cost: v.cost,
    profit: v.sales - v.cost,
    discountReduction: v.discountReduction,
  }));
  listRows.sort((a, b) => {
    if (b.sales !== a.sales) return b.sales - a.sales;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  const totalSales = listRows.reduce((s, r) => s + r.sales, 0);
  const totalCost = listRows.reduce((s, r) => s + r.cost, 0);

  return {
    rows: listRows,
    totalSales,
    totalCost,
    grossProfit: totalSales - totalCost,
    earlyBirdReduction,
    specialReduction,
    discountReductionTotal: earlyBirdReduction + specialReduction,
    missingProjectCount,
    missingCostLineCount,
  };
}

export function buildProfitCopyText(params: {
  shopName: string;
  projectLabel: string;
  totals: ProfitTotals;
}): string {
  const { shopName, projectLabel, totals } = params;
  const lines: string[] = [];
  lines.push(`${shopName} · ${projectLabel}成本利润统计`);
  lines.push('=============');
  lines.push(`销售额：RM ${totals.totalSales.toFixed(2)}`);
  lines.push(`采购成本：RM ${totals.totalCost.toFixed(2)}`);
  lines.push(`毛利：RM ${totals.grossProfit.toFixed(2)}`);
  lines.push('');
  lines.push(
    `早鸟让价（相对标价）：RM ${totals.earlyBirdReduction.toFixed(2)}`
  );
  lines.push(
    `特惠让价（相对标价）：RM ${totals.specialReduction.toFixed(2)}`
  );
  lines.push(`优惠让价合计：RM ${totals.discountReductionTotal.toFixed(2)}`);
  lines.push('');
  lines.push('按商品/方案汇总');
  for (const r of totals.rows) {
    const tag = r.kind === 'scheme' ? '套餐方案' : '商品';
    lines.push(
      `[${tag}] ${r.name} ×${r.quantity} · 销 RM ${r.sales.toFixed(2)} · 本 RM ${r.cost.toFixed(2)} · 利 RM ${r.profit.toFixed(2)} · 减免 RM ${r.discountReduction.toFixed(2)}`
    );
  }
  lines.push('=============');
  return lines.join('\n');
}

export function buildProfitCsv(totals: ProfitTotals): string {
  const header = '类型,名称,数量,销售额,采购成本,毛利,优惠减免';
  const body = totals.rows.map((r) => {
    const type = r.kind === 'scheme' ? '套餐方案' : '商品';
    const name = r.name.replace(/"/g, '""');
    return `${type},"${name}",${r.quantity},${r.sales.toFixed(2)},${r.cost.toFixed(2)},${r.profit.toFixed(2)},${r.discountReduction.toFixed(2)}`;
  });
  const sumReduction = totals.rows.reduce((s, r) => s + r.discountReduction, 0);
  const tail = [
    '',
    `合计,,,${totals.totalSales.toFixed(2)},${totals.totalCost.toFixed(2)},${totals.grossProfit.toFixed(2)},${sumReduction.toFixed(2)}`,
    `早鸟让价,,,,,,${totals.earlyBirdReduction.toFixed(2)}`,
    `特惠让价,,,,,,${totals.specialReduction.toFixed(2)}`,
  ];
  return [header, ...body, ...tail].join('\n');
}
