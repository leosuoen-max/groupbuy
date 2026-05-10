import type { MockShopHome } from '../../data/mockShopHome';
import { formatRemainingShort } from '../../lib/countdown';
import { DESIGN_PRICE_TEAL } from '../../lib/shopTheme';

type ShopProjectStatusCardProps = {
  data: MockShopHome;
  now: Date;
};

function formatDeadlineDisplay(closesAt: Date, referenceNow: Date): string {
  const y = closesAt.getFullYear();
  const m = closesAt.getMonth() + 1;
  const d = closesAt.getDate();
  const hh = closesAt.getHours().toString().padStart(2, '0');
  const mm = closesAt.getMinutes().toString().padStart(2, '0');
  const datePart =
    y !== referenceNow.getFullYear() ? `${y}年${m}月${d}日` : `${m}月${d}日`;
  return `${datePart} ${hh}:${mm}`;
}

export function ShopProjectStatusCard({ data, now }: ShopProjectStatusCardProps) {
  const closes = new Date(data.closesAt);
  const timeLabel = formatDeadlineDisplay(closes, now);

  const remaining = formatRemainingShort(data.closesAt, now);

  const metaLine =
    data.status === 'closed' ? (
      <p className="mb-3 text-[13px] leading-snug text-gray-600">
        <strong className="font-semibold text-gray-900">已截止</strong>
      </p>
    ) : data.status === 'full' ? (
      <p className="mb-3 text-[13px] leading-snug text-gray-600">
        <strong className="font-semibold text-gray-900">已满员</strong>
      </p>
    ) : !remaining ? (
      <p className="mb-3 text-[13px] leading-snug text-gray-600">
        <strong className="font-semibold text-gray-900">已截止</strong>
      </p>
    ) : (
      <p className="mb-3 text-[13px] leading-relaxed">
        <span className="font-medium text-slate-800">报名进行中</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600">距截止还有 </span>
        <span
          className="font-semibold tabular-nums tracking-tight"
          style={{ color: DESIGN_PRICE_TEAL }}
        >
          {remaining}
        </span>
      </p>
    );

  return (
    <section className="px-4 pb-4" aria-label="团购状态">
      {metaLine}
      <dl className="grid grid-cols-3 gap-x-2 border-t border-gray-100 pt-3 text-center sm:gap-x-3">
        <div className="min-w-0 px-1">
          <dt className="mb-1 text-[11px] font-medium text-gray-500">截止时间</dt>
          <dd className="truncate text-sm font-semibold tabular-nums text-gray-900">
            {timeLabel}
          </dd>
        </div>
        <div className="min-w-0 px-1">
          <dt className="mb-1 text-[11px] font-medium text-gray-500">已报人数</dt>
          <dd className="text-sm font-semibold tabular-nums text-gray-900">
            {data.orderCount} 单
          </dd>
        </div>
        <div className="min-w-0 px-1">
          <dt className="mb-1 text-[11px] font-medium text-gray-500">配送方式</dt>
          <dd className="line-clamp-2 text-sm font-medium leading-snug text-gray-900">
            {data.deliveryLabel}
          </dd>
        </div>
      </dl>
    </section>
  );
}
