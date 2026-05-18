import { FEITUAN_HOME, FEITUAN_TOPBAR_URL } from '../../lib/feituanHomeTheme';
import { FeituanHomeShareIcon } from './FeituanNavIcons';

const C = FEITUAN_HOME;

/** 设计图 1024×341，略裁底边去掉留白 */
const TOPBAR_ASPECT_W = 1024;
const TOPBAR_ASPECT_H = 292;
/** 在基准位置上微调：左 1 份、下 2 份（份 = 0.5rem） */
const SHARE_BTN_NUDGE_X = '0.5rem';
const SHARE_BTN_NUDGE_Y = '1rem';

export type FeituanHomePageHeaderProps = {
  onShare?: () => void;
};

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
            className="absolute right-3 top-[42%] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#0F8F5F] active:scale-95"
            style={{
              boxShadow: '0 2px 10px rgba(15, 143, 95, 0.2)',
              transform: `translate(calc(-1 * ${SHARE_BTN_NUDGE_X}), calc(-50% + ${SHARE_BTN_NUDGE_Y}))`,
            }}
            aria-label="分享"
          >
            <FeituanHomeShareIcon />
          </button>
        ) : null}
      </div>
    </header>
  );
}
