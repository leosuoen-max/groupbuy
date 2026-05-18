type IconProps = {
  size?: number;
  className?: string;
};

const DEFAULT_SIZE = 18;
const STROKE = 1.75;

/** 参考四图标分享：左下弯弧 + 右上折线箭头 */
const FEITUAN_SHARE_ARROW = {
  arc: 'M6.5 16.8c1.4-4.8 5.4-7.8 9.8-7.3 2.6.3 4.7 1.6 5.9 3.6',
  head: 'M16.2 6.2h4.3v4.3M16.2 6.2l5.1-5.1',
} as const;

/** 返回：左箭头 */
export function FeituanNavBackIcon({ size = DEFAULT_SIZE, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M15 6.5 9.5 12 15 17.5"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** iOS 分享：托盘 + 向上箭头（略内缩，小尺寸下不顶边） */
const FEITUAN_IOS_SHARE_PATHS = {
  tray: 'M7.25 14.5V17.25a1.75 1.75 0 001.75 1.75h6a1.75 1.75 0 001.75-1.75V14.5',
  arrow: 'M12 6.25v7.25M9.25 9.5 12 6.25l2.75 3.25',
} as const;

/** 饭团首页顶栏分享（适配 h-11 圆钮，iOS 分享图标） */
export function FeituanHomeShareIcon({
  size = 22,
  className,
}: IconProps) {
  const stroke = 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d={FEITUAN_IOS_SHARE_PATHS.arrow}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={FEITUAN_IOS_SHARE_PATHS.tray}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeituanShareArrowGraphic({
  size = DEFAULT_SIZE,
  className,
  strokeWidth = STROKE,
}: IconProps & { strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d={FEITUAN_SHARE_ARROW.arc}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={FEITUAN_SHARE_ARROW.head}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 分享：左下弯弧 + 右上箭头（与参考四图标一致） */
export function FeituanNavShareIcon({ size = DEFAULT_SIZE, className }: IconProps) {
  return <FeituanShareArrowGraphic size={size} className={className} />;
}

/** 饭团底栏 Tab 购物车（与 FeituanHomeBottomNav 一致） */
export function FeituanBottomTabCartIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M6 6h15l-1.5 9h-11L6 6z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path
        d="M6 6L5 3H2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle cx={9} cy={20} r={1.5} fill="currentColor" />
      <circle cx={17} cy={20} r={1.5} fill="currentColor" />
    </svg>
  );
}

/** 购物车：篮身 + 把手 + 双轮 */
export function FeituanNavCartIcon({ size = DEFAULT_SIZE, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M4 5.5h2.2l1.7 8.8a1.35 1.35 0 0 0 1.33 1.08h8.1a1.35 1.35 0 0 0 1.33-1.08L19.5 8.5H7.5"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 5.5 6.2 3.2h2.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={9.2} cy={18.8} r={1.55} fill="currentColor" />
      <circle cx={16.3} cy={18.8} r={1.55} fill="currentColor" />
    </svg>
  );
}

/** 更多：中间大、两侧小 */
export function FeituanNavMoreIcon({ size = DEFAULT_SIZE, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle cx={6} cy={12} r={1.05} fill="currentColor" />
      <circle cx={12} cy={12} r={1.75} fill="currentColor" />
      <circle cx={18} cy={12} r={1.05} fill="currentColor" />
    </svg>
  );
}
