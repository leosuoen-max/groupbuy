import type { ProductionTotals } from '../../lib/reconciliationSummary';

type Props = {
  /** 由父页面按口径汇总后的结果（饭团：全平台订单；商户：本店订单） */
  totals: ProductionTotals;
  /** 口径说明，如「5/16 午 · 某项目 · 本店订单」 */
  scopeCaption: string;
};

/** 仅展示汇总数字；订单范围与清单包含由饭团/商户对账页各自传入 totals。 */
export function ProductionSummaryStatsBar({ totals, scopeCaption }: Props) {
  return (
    <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 sm:px-4">
      <p className="mb-2 text-center text-[10px] leading-snug text-indigo-700/90 sm:text-xs">
        {scopeCaption}
      </p>
      <div className="grid grid-cols-3 divide-x divide-indigo-200/80">
        <div className="min-w-0 px-1 text-center sm:px-3">
          <div className="text-[11px] font-medium leading-tight text-indigo-800 sm:text-xs">
            总出品
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-indigo-950 sm:text-2xl">
            {totals.totalQty}
          </div>
        </div>
        <div className="min-w-0 px-1 text-center sm:px-3">
          <div className="text-[11px] font-medium leading-tight text-indigo-800 sm:text-xs">
            普通商品
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-indigo-950 sm:text-2xl">
            {totals.normalTotalQty}
          </div>
        </div>
        <div className="min-w-0 px-1 text-center sm:px-3">
          <div className="text-[11px] font-medium leading-tight text-indigo-800 sm:text-xs">
            套餐拆解
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-indigo-950 sm:text-2xl">
            {totals.bundleOptionTotalQty}
          </div>
        </div>
      </div>
    </div>
  );
}
