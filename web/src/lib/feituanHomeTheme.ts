/**
 * 大马饭团顾客首页：绿色品牌主色 + 橙色仅作截单/提醒点缀。
 */
export const FEITUAN_HOME = {
  primary: '#0F8F5F',
  primaryBright: '#00A86B',
  primaryLight: '#E6F8EF',
  primaryBg: '#F6FBF7',
  primaryBorder: '#D8F0E4',
  primaryBorderLight: '#E2F3EA',
  timingBg: '#F0FAF5',
  timingBorder: '#BDEBD5',
  warning: '#F97316',
  warningLight: '#FFF3E8',
  warningBorder: '#FED7AA',
  card: '#FFFFFF',
  textMain: '#111827',
  textSub: '#6B7280',
  textMuted: '#9CA3AF',
  cardShadow: '0 4px 14px rgba(15, 143, 95, 0.08)',
  navShadow: '0 -8px 24px rgba(15, 143, 95, 0.08)',
} as const;

/** Tailwind 类名（完整字符串，供 JIT 扫描） */
export const FEITUAN_TW = {
  text: 'text-[#0F8F5F]',
  textOnLight: 'text-[#0F8F5F]',
  panel: 'border-[#D8F0E4] bg-[#E6F8EF] text-[#0F8F5F]',
  panelLoose: 'border-[#D8F0E4] bg-[#E6F8EF]/70 text-[#0F8F5F]',
  panelHeader: 'border-[#D8F0E4] bg-[#E6F8EF] px-3 py-3 text-[#0F8F5F]',
  subpanel: 'bg-white/80 text-[11px] text-[#0F8F5F] ring-1 ring-[#BDEBD5]',
  selected:
    'border-[#0F8F5F] bg-white text-[#111827] ring-2 ring-[#BDEBD5]',
  selectedSoft:
    'border-[#0F8F5F] bg-[#E6F8EF]/50 ring-2 ring-[#0F8F5F]/35',
  radioSelected:
    'border-[#0F8F5F] bg-[#0F8F5F] ring-2 ring-white ring-inset',
  btn: 'bg-[#0F8F5F] text-white',
  btnMd:
    'inline-flex items-center justify-center rounded-xl bg-[#0F8F5F] text-sm font-semibold text-white disabled:opacity-60',
  btnSm:
    'rounded-lg bg-[#0F8F5F] px-3 py-1.5 text-[11px] font-semibold text-white',
  dashedBtn:
    'border-dashed border-[#0F8F5F] bg-[#E6F8EF]/80 text-[#0F8F5F]',
  confirmedBorder: 'border-l-[#0F8F5F]',
  confirmedSurface: 'bg-[#E6F8EF]/80',
  confirmedPill: 'bg-[#E6F8EF] text-[#0F8F5F]',
  statusConfirmed: 'text-[#0F8F5F]',
  hint: 'text-[#0F8F5F]',
  successMsg: 'rounded bg-[#E6F8EF] px-2 py-1 text-xs text-[#0F8F5F]',
  inputFocus:
    'ring-[#0F8F5F]/30 focus:border-[#0F8F5F] focus:ring-2',
} as const;

export function feituanOrShopGreen(
  isFeituan: boolean,
  feituanClass: string,
  shopClass: string
): string {
  return isFeituan ? feituanClass : shopClass;
}
