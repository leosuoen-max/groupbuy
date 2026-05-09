import type { MockShopHome } from '../../data/mockShopHome';

export type ShopHeaderProps = {
  data: MockShopHome;
  onShare: () => void;
  onOpenMore: () => void;
};

function shopInitial(name: string) {
  const t = name.trim();
  return t ? t.slice(0, 1) : '店';
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#9ca3af"
      strokeWidth={2}
      className={className}
      aria-hidden
    >
      <rect x={3} y={4} width={18} height={18} rx={2} />
      <line x1={16} y1={2} x2={16} y2={6} />
      <line x1={8} y1={2} x2={8} y2={6} />
      <line x1={3} y1={10} x2={21} y2={10} />
    </svg>
  );
}

/** 设计稿同款：方框 + 向上箭头（分享/转发） */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#333"
      strokeWidth={2}
      strokeLinecap="round"
      className={className ?? 'h-[15px] w-[15px]'}
      aria-hidden
    >
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1={12} y1={2} x2={12} y2={15} />
    </svg>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="#333"
      viewBox="0 0 24 24"
      className={className ?? 'h-[15px] w-[15px]'}
      aria-hidden
    >
      <circle cx={5} cy={12} r={2} />
      <circle cx={12} cy={12} r={2} />
      <circle cx={19} cy={12} r={2} />
    </svg>
  );
}

export function ShopHeader({ data, onShare, onOpenMore }: ShopHeaderProps) {
  const logoUrl = data.shopLogoUrl?.trim();

  return (
    <header className="bg-white">
      <div className="relative h-[220px] w-full overflow-hidden">
        {data.bannerUrl ? (
          <img
            src={data.bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-white"
            style={{ backgroundColor: data.themeColor }}
          >
            <span className="text-xl font-semibold leading-snug drop-shadow-sm">{data.shopName}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/[0.35] via-black/25 to-black/10" />

        <div className="absolute bottom-[14px] left-[14px] right-[14px] flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-full border-2 border-white/95 bg-white object-cover shadow-[0_1px_6px_rgba(0,0,0,0.2)]"
                loading="lazy"
              />
            ) : (
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-white/95 text-[15px] font-semibold text-white shadow-[0_1px_6px_rgba(0,0,0,0.2)]"
                style={{
                  background: 'linear-gradient(135deg, #43b87a, #2fa068)',
                }}
              >
                {shopInitial(data.shopName)}
              </div>
            )}
            <span className="truncate text-base font-semibold tracking-wide text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.35)]">
              {data.shopName}
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onShare}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/[0.92] shadow-[0_1px_4px_rgba(0,0,0,0.08)] backdrop-blur-sm active:bg-white"
              aria-label="分享"
            >
              <ShareIcon />
            </button>
            <button
              type="button"
              onClick={onOpenMore}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/[0.92] shadow-[0_1px_4px_rgba(0,0,0,0.08)] backdrop-blur-sm active:bg-white"
              aria-label="更多"
            >
              <MoreHorizontalIcon />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pb-3 pt-[18px]">
        <CalendarIcon />
        <h1 className="text-xl font-bold leading-snug tracking-tight text-[#111]">{data.projectTitle}</h1>
      </div>
    </header>
  );
}
