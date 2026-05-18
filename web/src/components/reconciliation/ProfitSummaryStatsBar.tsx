import type { ProfitTotals } from '../../lib/reconciliationProfit';

function formatProfitStatAmount(amount: number): string {
  return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1);
}

type Props = {
  /** 由父页面按口径汇总（饭团：全平台；商户：本店） */
  totals: ProfitTotals;
  /** 口径说明，如「凭证时间 · 项目 · 本店订单」 */
  scopeCaption: string;
};

type Cell = { label: string; value: string };

function StatRow({ cells }: { cells: Cell[] }) {
  return (
    <div className="grid grid-cols-3">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0 px-1 py-2.5 text-center sm:px-3 sm:py-3">
          <div className="text-[11px] font-medium leading-tight text-violet-800 sm:text-xs">
            {cell.label}
          </div>
          <div className="mt-1 text-base font-bold tabular-nums text-violet-950 sm:text-xl">
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 仅展示汇总数字；订单范围、时间与清单包含由饭团/商户对账页传入 totals。 */
export function ProfitSummaryStatsBar({ totals, scopeCaption }: Props) {
  const row1: Cell[] = [
    { label: '销售额', value: formatProfitStatAmount(totals.totalSales) },
    { label: '成本', value: formatProfitStatAmount(totals.totalCost) },
    { label: '毛利', value: formatProfitStatAmount(totals.grossProfit) },
  ];
  const row2: Cell[] = [
    {
      label: '已确认',
      value: formatProfitStatAmount(totals.bucketGroupAmounts.confirmed),
    },
    {
      label: '待确认',
      value: formatProfitStatAmount(totals.bucketGroupAmounts.pending),
    },
    {
      label: '待付款',
      value: formatProfitStatAmount(totals.bucketGroupAmounts.unpaid),
    },
  ];
  const row3: Cell[] = [
    { label: '早鸟让价', value: formatProfitStatAmount(totals.earlyBirdReduction) },
    { label: '特惠让价', value: formatProfitStatAmount(totals.specialReduction) },
    {
      label: '让价合计',
      value: formatProfitStatAmount(totals.discountReductionTotal),
    },
  ];

  return (
    <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50 px-3 py-3 sm:px-4">
      <p className="mb-2 text-center text-[10px] leading-snug text-violet-700/90 sm:text-xs">
        {scopeCaption}
      </p>
      <div className="divide-y divide-violet-200/80 overflow-hidden rounded-lg border border-violet-100/80 bg-white/40">
        <StatRow cells={row1} />
        <StatRow cells={row2} />
        <StatRow cells={row3} />
      </div>
    </div>
  );
}
