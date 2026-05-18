import type { DeliveryManifestSummary } from '../../lib/feituanDeliveryReconciliation';

type Props = {
  /** 由父页面按口径汇总后的配送清单统计（饭团：全平台；商户：本店） */
  summary: DeliveryManifestSummary;
  /** 口径说明，如「5/16 午 · 某项目 · 本店订单」 */
  scopeCaption: string;
};

/** 仅展示汇总数字；订单范围与清单包含由饭团/商户对账页各自传入 summary。 */
export function DeliverySummaryStatsBar({ summary, scopeCaption }: Props) {
  return (
    <div className="mb-5 rounded-xl border border-sky-100 bg-sky-50 px-3 py-3 sm:px-4">
      <p className="mb-2 text-center text-[10px] leading-snug text-sky-700/90 sm:text-xs">
        {scopeCaption}
      </p>
      <div className="grid grid-cols-3 divide-x divide-sky-200/80">
        <div className="min-w-0 px-1 text-center sm:px-3">
          <div className="text-[11px] font-medium leading-tight text-sky-800 sm:text-xs">
            总配送单数
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-sky-950 sm:text-2xl">
            {summary.totalOrderCount}
          </div>
        </div>
        <div className="min-w-0 px-1 text-center sm:px-3">
          <div className="text-[11px] font-medium leading-tight text-sky-800 sm:text-xs">
            配送区
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-sky-950 sm:text-2xl">
            {summary.zoneCount}
          </div>
        </div>
        <div className="min-w-0 px-1 text-center sm:px-3">
          <div className="text-[11px] font-medium leading-tight text-sky-800 sm:text-xs">
            配送点
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-sky-950 sm:text-2xl">
            {summary.pointCount}
          </div>
        </div>
      </div>
    </div>
  );
}
