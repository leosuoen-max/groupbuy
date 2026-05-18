/** 饭团悬浮导航钮：半透明深底 + 浅描边 + 白图标（淘宝商品页） */
export const FEITUAN_FLOAT_NAV_BTN_CLASS =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-white/30 bg-black/45 text-white shadow-[0_1px_8px_rgba(0,0,0,0.18)] backdrop-blur-[4px] active:bg-black/55';

/** 饭团项目页顶栏悬浮钮：透明底，淡绿描边 + 淡绿图标（尺寸不变） */
export const FEITUAN_PROJECT_FLOAT_NAV_BTN_CLASS =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-[#6EC99A] bg-transparent text-[#6EC99A] active:opacity-80';

export function feituanFloatNavBtnProps() {
  return { className: FEITUAN_FLOAT_NAV_BTN_CLASS };
}

export function feituanProjectFloatNavBtnProps() {
  return { className: FEITUAN_PROJECT_FLOAT_NAV_BTN_CLASS };
}
