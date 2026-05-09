import type { MockShopHome } from '../../data/mockShopHome';
import { formatRemainingShort } from '../../lib/countdown';

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

  const remaining = formatRemainingShort(data.closesAt, now);

  const metaLine =
    data.status === 'closed' ? (
      <p className="mb-2.5 text-[13px] leading-snug text-gray-500">
        <strong className="font-semibold text-gray-700">已截止</strong>
      </p>
    ) : data.status === 'full' ? (
      <p className="mb-2.5 text-[13px] leading-snug text-gray-500">
        <strong className="font-semibold text-gray-700">已满员</strong>
      </p>
    ) : !remaining ? (
      <p className="mb-2.5 text-[13px] leading-snug text-gray-500">
        <strong className="font-semibold text-gray-700">已截止</strong>
      </p>
    ) : (
      <p className="mb-2.5 text-[13px] leading-snug text-gray-500">
        <strong className="font-semibold text-gray-700">报名中</strong>
        {' · '}
        <span>还剩 {remaining}截止</span>
      </p>
    );

  return (
    <section className="px-4 pb-4" aria-label="团购状态">
      {metaLine}
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-center">
        <div className="min-w-0">
          <dt className="mb-0.5 text-[11px] font-normal text-gray-400">截止时间</dt>
          <dd className="truncate text-sm font-semibold text-gray-900">{timeLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-0.5 text-[11px] font-normal text-gray-400">已报人数</dt>
          <dd className="text-sm font-semibold text-gray-900">{data.orderCount} 单</dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-0.5 text-[11px] font-normal text-gray-400">配送方式</dt>
          <dd className="line-clamp-2 text-sm font-semibold text-gray-900">{data.deliveryLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
