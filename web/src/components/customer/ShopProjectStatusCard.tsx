import type { MockShopHome } from '../../data/mockShopHome';
import { formatRemainingShort } from '../../lib/countdown';

function statusHeadline(data: MockShopHome, now: Date): string {
  if (data.status === 'closed') return '已截止';
  if (data.status === 'full') return '已满员';
  const left = formatRemainingShort(data.closesAt, now);
  if (!left) return '已截止';
  return `报名中 · 还剩 ${left}截止`;
}

type ShopProjectStatusCardProps = {
  data: MockShopHome;
  now: Date;
};

export function ShopProjectStatusCard({ data, now }: ShopProjectStatusCardProps) {
  const closes = new Date(data.closesAt);
  const timeLabel = closes.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <section className="px-4 pt-3" aria-label="团购状态">
      <div className="rounded-xl bg-emerald-50 px-3.5 py-3.5 ring-1 ring-emerald-100">
        <p className="text-[13px] font-semibold leading-snug text-emerald-900">
          {statusHeadline(data, now)}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-gray-500">截止时间</div>
            <div className="mt-1 truncate text-sm font-semibold text-gray-900">{timeLabel}</div>
          </div>
          <div className="min-w-0 border-x border-emerald-200/90 px-1">
            <div className="text-[11px] font-medium text-gray-500">已报人数</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">{data.orderCount} 单</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-gray-500">配送方式</div>
            <div className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">
              {data.deliveryLabel}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
