/** 饭团悬浮导航钮：半透明深底 + 浅描边 + 白图标（淘宝商品页） */
export const FEITUAN_FLOAT_NAV_BTN_CLASS =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-white/30 bg-black/45 text-white shadow-[0_1px_8px_rgba(0,0,0,0.18)] backdrop-blur-[4px] active:bg-black/55';

/** 饭团项目页顶栏悬浮钮：40px 圆钮、毛玻璃白底、#39B987 图标 */
export const FEITUAN_PROJECT_FLOAT_NAV_BTN_CLASS =
  'relative flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.65] bg-white/[0.82] text-[#39B987] shadow-[0_2px_8px_rgba(0,0,0,0.16)] backdrop-blur-[8px] active:opacity-90';

export function feituanFloatNavBtnProps() {
  return { className: FEITUAN_FLOAT_NAV_BTN_CLASS };
}

export function feituanProjectFloatNavBtnProps() {
  return { className: FEITUAN_PROJECT_FLOAT_NAV_BTN_CLASS };
}
