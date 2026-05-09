import type { ReactNode } from 'react';
import { DESIGN_PAGE_BG, H5_COLUMN_CLASS } from '../lib/shopTheme';

/**
 * 全站 H5 外壳：灰底铺满视口，中间白底窄栏（420px）居中。
 * 桌面浏览器与手机浏览器视觉一致，避免横屏拉扁布局。
 */
export function H5Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh w-full" style={{ backgroundColor: DESIGN_PAGE_BG }}>
      <div
        className={`mx-auto min-h-svh w-full bg-white pt-[env(safe-area-inset-top,0px)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] ${H5_COLUMN_CLASS}`}
      >
        {children}
      </div>
    </div>
  );
}
