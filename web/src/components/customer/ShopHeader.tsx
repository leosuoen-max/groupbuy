import type { MockShopHome, ProjectStatus } from '../../data/mockShopHome';
import { formatRemainingShort } from '../../lib/countdown';

type ShopHeaderProps = {
  data: MockShopHome;
  now: Date;
};

function statusBarClass(status: ProjectStatus) {
  if (status === 'open') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (status === 'full') return 'bg-amber-50 text-amber-900 border-amber-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function statusMessage(data: MockShopHome, now: Date) {
  if (data.status === 'closed') return '已截止';
  if (data.status === 'full') return '已满员';
  const left = formatRemainingShort(data.closesAt, now);
  if (!left) return '已截止';
  return `报名中 · 还剩 ${left}截止`;
}

export function ShopHeader({ data, now }: ShopHeaderProps) {
  const closes = new Date(data.closesAt);
  const timeLabel = closes.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <header className="border-b border-gray-100 bg-white">
      {data.bannerUrl ? (
        <img
          src={data.bannerUrl}
          alt=""
          className="h-40 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="flex min-h-[7rem] items-center justify-center px-4 py-6 text-center text-white"
          style={{ backgroundColor: data.themeColor }}
        >
          <span className="text-xl font-semibold leading-snug">
            {data.shopName}
          </span>
        </div>
      )}

      {data.bannerUrl ? (
        <div className="px-4 py-3 text-center">
          <h1 className="text-xl font-semibold text-gray-900">{data.shopName}</h1>
        </div>
      ) : null}

      <div
        className={`mx-3 mb-3 rounded-lg border px-3 py-2 text-sm ${statusBarClass(data.status)}`}
      >
        {statusMessage(data, now)}
      </div>

      <div className="mx-3 mb-4 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-gray-50 px-1 py-2">
          <div className="text-xs text-gray-500">截止时间</div>
          <div className="font-medium text-gray-900">{timeLabel}</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-1 py-2">
          <div className="text-xs text-gray-500">已报人数</div>
          <div className="font-medium text-gray-900">{data.orderCount} 单</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-1 py-2">
          <div className="text-xs text-gray-500">配送方式</div>
          <div className="truncate font-medium text-gray-900">
            {data.deliveryLabel}
          </div>
        </div>
      </div>
    </header>
  );
}
