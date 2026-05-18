type IconProps = {
  size?: number;
  className?: string;
};

const DEFAULT_SIZE = 18;
const STROKE = 1.75;

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

/** 饭团首页顶栏分享：弯弧箭头，尺寸由外层圆钮 CSS 控制 */
export function FeituanHomeShareIcon({ size, className }: IconProps) {
  const stroke = 2.35;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      width={size}
      height={size}
      className={size != null ? className : (className ?? 'h-[58%] w-[58%]')}
    >
      <path
        d="M6.75 17c1.55-5.1 5.35-8.15 10.1-7.45 2.55.35 4.55 1.55 5.65 3.55"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 6.75h4.5v4.5M16 6.75l5.25-5.25"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 分享：左下弯弧 + 右上箭头（淘宝商品页） */
export function FeituanNavShareIcon({ size = DEFAULT_SIZE, className }: IconProps) {
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
        d="M6.5 16.8c1.4-4.8 5.4-7.8 9.8-7.3 2.6.3 4.7 1.6 5.9 3.6"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.2 6.2h4.3v4.3M16.2 6.2l5.1-5.1"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
