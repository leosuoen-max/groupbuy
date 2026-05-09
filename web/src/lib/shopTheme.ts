/**
 * 顾客端 UI 设计稿对齐：主题色仅在下列预设中选择，默认薄荷绿。
 * 主行动色（+、提交）= themeColor；价格/余量强调色固定为设计稿青绿。
 */
export const DEFAULT_SHOP_THEME_COLOR = '#08c279';

/** 设计稿主行动绿（与默认主题一致，用于兜底） */
export const DESIGN_ACTION_GREEN = '#08c279';

/** 设计稿价格/库存强调色（与主题独立，保证清单区视觉一致） */
export const DESIGN_PRICE_TEAL = '#0d9488';

/** 页面灰底 */
export const DESIGN_PAGE_BG = '#f3f4f1';

/** Tailwind：H5 中间栏宽度（与设计稿 .shell 420px、全局 H5Shell 一致；底栏/弹层对齐用） */
export const H5_COLUMN_CLASS = 'max-w-[420px]';

/** 分割线、边框 */
export const DESIGN_BORDER = '#e5e7eb';
export const DESIGN_BORDER_LIGHT = '#ececec';

export const SHOP_THEME_PRESETS: ReadonlyArray<{ id: string; name: string; hex: string }> = [
  { id: 'mint', name: '薄荷绿（推荐）', hex: '#08c279' },
  { id: 'teal', name: '青绿', hex: '#0d9488' },
  { id: 'emerald', name: '翠绿', hex: '#06A77D' },
  { id: 'coral', name: '珊瑚橙', hex: '#F77F00' },
  { id: 'chili', name: '辣椒红', hex: '#E63946' },
  { id: 'indigo', name: '靛蓝', hex: '#277DA1' },
  { id: 'rose', name: '玫瑰红', hex: '#C71F37' },
  { id: 'forest', name: '墨绿', hex: '#2D6A4F' },
] as const;

/** 仅承认 {@link SHOP_THEME_PRESETS} 中的色值，其余回落默认薄荷绿。 */
export function normalizeShopThemeColor(input: string | undefined | null): string {
  const t = (input ?? '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(t)) return DEFAULT_SHOP_THEME_COLOR;
  const lower = t.toLowerCase();
  const preset = SHOP_THEME_PRESETS.find((p) => p.hex.toLowerCase() === lower);
  return preset ? preset.hex : DEFAULT_SHOP_THEME_COLOR;
}
