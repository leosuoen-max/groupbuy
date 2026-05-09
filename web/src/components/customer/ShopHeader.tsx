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

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.75}
      stroke="currentColor"
      className={className ?? 'h-5 w-5 text-gray-900'}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.935-2.186 2.25 2.25 0 00-3.935 2.186z"
      />
    </svg>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 24 24"
      className={className ?? 'h-6 w-6 text-gray-800'}
      aria-hidden
    >
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  );
}

export function ShopHeader({ data, onShare, onOpenMore }: ShopHeaderProps) {
  const logoUrl = data.shopLogoUrl?.trim();

  return (
    <header className="bg-white">
      <div className="relative min-h-[13.5rem] w-full overflow-hidden sm:min-h-[15rem]">
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/25 to-black/10" />

        <div className="relative flex min-h-[13.5rem] flex-col justify-end sm:min-h-[15rem]">
          <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-16">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-full border-2 border-white/95 bg-white object-cover shadow-md"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-white/95 bg-white/95 text-xl font-bold text-gray-800 shadow-md">
                  {shopInitial(data.shopName)}
                </div>
              )}
              <span className="truncate text-lg font-semibold tracking-tight text-white drop-shadow-md">
                {data.shopName}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onShare}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-md backdrop-blur-sm active:bg-white"
                aria-label="分享"
              >
                <ShareIcon className="h-[1.35rem] w-[1.35rem] text-gray-900" />
              </button>
              <button
                type="button"
                onClick={onOpenMore}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-md backdrop-blur-sm active:bg-white"
                aria-label="更多"
              >
                <MoreHorizontalIcon />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-1 pt-4">
        <h1 className="text-[1.375rem] font-bold leading-snug tracking-tight text-gray-900 sm:text-2xl">
          {data.projectTitle}
        </h1>
      </div>
    </header>
  );
}
