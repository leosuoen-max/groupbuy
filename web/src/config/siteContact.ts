/**
 * 顾客端「想定制自己的店」展示的联系方式。
 *
 * 优先级：环境变量 `VITE_CUSTOM_SHOP_CONTACT`（见仓库根目录 `.env.example`）>
 * 下方常量 `SITE_OWNER_CONTACT_DEFAULT`。
 *
 * 在 `web/.env.local` 中设置时，单行即可；若要换行可写 `\\n`。
 */
export const SITE_OWNER_CONTACT_DEFAULT = ['微信：Leos1618', '电话：+60 135926860'].join('\n');

/** 对外一行引导（不含具体微信/电话，点按后再展示详情） */
export const CUSTOM_SHOP_CONTACT_TEASER = '✨ 想定制自己的店，立即联系';

export function getCustomShopContactLine(): string {
  const raw = import.meta.env.VITE_CUSTOM_SHOP_CONTACT;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim().replace(/\\n/g, '\n');
  }
  return SITE_OWNER_CONTACT_DEFAULT;
}
