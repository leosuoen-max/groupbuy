import { FEITUAN_HOME, FEITUAN_TOPBAR_URL } from '../../lib/feituanHomeTheme';
import { feituanHomeShareBtnProps } from './feituanFloatNavButton';
import { FeituanHomeShareIcon } from './FeituanNavIcons';

const C = FEITUAN_HOME;

/** 设计图 1024×341，略裁底边去掉留白 */
const TOPBAR_ASPECT_W = 1024;
const TOPBAR_ASPECT_H = 292;
/**
 * 设计稿 1024×341，顶栏可视高 292（裁底留白）。
 * 主标绿弧底边 y≈198 → 198/292，分享钮底边与此对齐（勿与标语对齐）。
 */
const TOPBAR_VISIBLE_H = 292;
/** 设计稿 341px 高时主标（紫字+绿弧）底边约 y=198 */
const LOGO_MARK_BOTTOM_Y = 198;
const SHARE_ALIGN_LOGO_BOTTOM_RATIO = LOGO_MARK_BOTTOM_Y / TOPBAR_VISIBLE_H;

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
          className="absolute inset-x-0 top-0 z-0 block w-full select-none"
          decoding="async"
        />
        {onShare ? (
          <button
            type="button"
            onClick={onShare}
            className={`absolute right-[3.6%] z-20 -translate-y-full ${feituanHomeShareBtnProps().className}`}
            style={{
              top: `${SHARE_ALIGN_LOGO_BOTTOM_RATIO * 100}%`,
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
