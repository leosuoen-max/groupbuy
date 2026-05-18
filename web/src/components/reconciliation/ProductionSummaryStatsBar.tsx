import type { ProductionTotals } from '../../lib/reconciliationSummary';

type Props = {
  totals: ProductionTotals;
};

export function ProductionSummaryStatsBar({ totals }: Props) {
  return (
    <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-indigo-200/80">
        <div className="text-center sm:px-3">
          <div className="text-xs font-medium text-indigo-800">总出品份数</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">
            {totals.totalQty}
          </div>
        </div>
        <div className="text-center sm:px-3">
          <div className="text-xs font-medium text-indigo-800">普通商品份数</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">
            {totals.normalTotalQty}
          </div>
        </div>
        <div className="text-center sm:px-3">
          <div className="text-xs font-medium text-indigo-800">套餐拆解份数</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">
            {totals.bundleOptionTotalQty}
          </div>
        </div>
      </div>
    </div>
  );
}
