/** 饭团悬浮导航钮：半透明深底 + 浅描边 + 白图标（淘宝商品页） */
export const FEITUAN_FLOAT_NAV_BTN_CLASS =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-white/30 bg-black/45 text-white shadow-[0_1px_8px_rgba(0,0,0,0.18)] backdrop-blur-[4px] active:bg-black/55';

/**
 * 饭团首页顶栏分享：随顶栏宽度等比缩放（约顶栏高的 30%），透明底 + 淡绿描边。
 * clamp 保证小屏可点、大屏不过大。
 */
export const FEITUAN_HOME_SHARE_BTN_CLASS =
  'relative flex aspect-square w-[clamp(1.875rem,8.2vw,2.625rem)] shrink-0 items-center justify-center rounded-full border border-[#6EC99A] bg-transparent text-[#0F8F5F] active:scale-95 active:opacity-90';

export function feituanFloatNavBtnProps() {
  return { className: FEITUAN_FLOAT_NAV_BTN_CLASS };
}

export function feituanHomeShareBtnProps() {
  return { className: FEITUAN_HOME_SHARE_BTN_CLASS };
}
