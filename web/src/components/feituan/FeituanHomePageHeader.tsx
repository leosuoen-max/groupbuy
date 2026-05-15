import { FEITUAN_HOME, FEITUAN_TOPBAR_URL } from '../../lib/feituanHomeTheme';

const C = FEITUAN_HOME;

/** 设计图 1024×341，略裁底边去掉留白 */
const TOPBAR_ASPECT_W = 1024;
const TOPBAR_ASPECT_H = 292;

export type FeituanHomePageHeaderProps = {
  onShare?: () => void;
};

function IosShareIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v9M8.5 8.5 12 5l3.5 3.5"
        stroke={C.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 14v4a2 2 0 002 2h8a2 2 0 002-2v-4"
        stroke={C.primary}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 饭团首页顶栏：长方形设计图铺满宽度，底部略裁切；右侧叠加分享按钮。
 */
export function FeituanHomePageHeader({ onShare }: FeituanHomePageHeaderProps) {
  return (
    <header
      className="w-full"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        backgroundColor: C.primaryBg,
      }}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{
          aspectRatio: `${TOPBAR_ASPECT_W} / ${TOPBAR_ASPECT_H}`,
        }}
      >
        <img
          src={FEITUAN_TOPBAR_URL}
          alt="大马饭团 · 好饭团 · 好生活"
          className="absolute inset-x-0 top-0 block w-full select-none"
          decoding="async"
        />
        {onShare ? (
          <button
            type="button"
            onClick={onShare}
            className="absolute right-3 top-[42%] z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white active:scale-95"
            style={{ boxShadow: '0 2px 10px rgba(15, 143, 95, 0.2)' }}
            aria-label="分享"
          >
            <IosShareIcon />
          </button>
        ) : null}
      </div>
    </header>
  );
}
