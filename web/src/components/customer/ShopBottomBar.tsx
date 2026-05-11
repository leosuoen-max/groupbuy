import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectStatus } from '../../data/mockShopHome';
import { CustomShopContactModal } from '../CustomShopContactModal';
import { CUSTOM_SHOP_CONTACT_TEASER } from '../../config/siteContact';
import { formatMYR } from '../../lib/formatMYR';
import { DESIGN_BORDER, H5_COLUMN_CLASS } from '../../lib/shopTheme';
import { ShopMoreMenuSheet } from './ShopMoreMenuSheet';

type ShopBottomBarProps = {
  shopSlug: string;
  projectId: string;
  themeColor: string;
  projectStatus: ProjectStatus;
  totalQty: number;
  totalAmount: number;
  onSubmit: () => void;
  /** 左侧主按钮是否展示「我的订单」（已登录用户通常为 true） */
  showMyOrdersPrimary?: boolean;
  /** 是否在「更多」里展示「我的订单」（游客有过订单时仅在「更多」展示，避免占满底栏） */
  showMyOrdersInMore?: boolean;
  /** 是否是店铺创建人（shops.ownerId） */
  isShopOwner?: boolean;
  /** permissions 表角色（被邀请管理员）；未登录则无 */
  invitedRole?: 'normal_admin' | 'high_admin' | null;
  /** 覆盖主按钮文案（例如加购模式） */
  submitLabelOverride?: string;
  /** 额外禁用提交（不影响关闭状态判断） */
  forceDisableSubmit?: boolean;
  /**
   * full：我的订单 + 更多 + 提交（默认）
   * dual：仅「我的订单」+「请选择商品 / 提交」（与顶栏「更多」配合）
   */
  variant?: 'full' | 'dual';
};

const ghostBtn =
  'inline-flex shrink-0 items-center justify-center rounded-full border bg-white px-[18px] py-2.5 text-sm font-semibold text-[#111] transition active:bg-gray-50 disabled:opacity-50';

export function ShopBottomBar({
  shopSlug,
  projectId,
  themeColor,
  projectStatus,
  totalQty,
  totalAmount,
  onSubmit,
  showMyOrdersPrimary = true,
  showMyOrdersInMore = false,
  isShopOwner = false,
  invitedRole = null,
  submitLabelOverride,
  forceDisableSubmit = false,
  variant = 'full',
}: ShopBottomBarProps) {
  const base = '/shop/' + encodeURIComponent(shopSlug) + '/' + encodeURIComponent(projectId);
  const closed = projectStatus === 'closed' || projectStatus === 'full';
  const canSubmit = !closed && totalQty > 0 && !forceDisableSubmit;
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  let primaryLabel = '请选择商品';
  if (closed) primaryLabel = '已截止';
  else if (submitLabelOverride) primaryLabel = submitLabelOverride;
  else if (totalQty > 0) {
    primaryLabel = `点此提交 · ${totalQty} 件 · ${formatMYR(totalAmount)}`;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopied(false);
    }
  };

  const primaryBtn =
    'flex min-h-[46px] flex-1 items-center justify-center rounded-full px-4 py-3 text-[15px] font-semibold text-white shadow-[0_2px_10px_rgba(8,194,121,0.25)] transition disabled:bg-gray-300 disabled:text-gray-100 disabled:shadow-none';

  if (variant === 'dual') {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-[#ececec] bg-white pb-[calc(10px+env(safe-area-inset-bottom,0px))] pt-2.5">
        <div className={`pointer-events-auto flex w-full gap-2.5 px-4 ${H5_COLUMN_CLASS}`}>
          <Link
            to={`${base}/my-orders`}
            className={ghostBtn}
            style={{ borderColor: DESIGN_BORDER }}
          >
            我的订单
          </Link>
          <button
            type="button"
            className={primaryBtn}
            style={{ backgroundColor: canSubmit ? themeColor : undefined }}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center border-t border-[#ececec] bg-white pb-[calc(10px+env(safe-area-inset-bottom,0px))] pt-2.5">
      <div className={`pointer-events-auto flex w-full gap-2.5 px-4 ${H5_COLUMN_CLASS}`}>
        {showMyOrdersPrimary ? (
          <Link
            to={`${base}/my-orders`}
            className={ghostBtn}
            style={{ borderColor: DESIGN_BORDER }}
          >
            我的订单
          </Link>
        ) : (
          <div className="w-0 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          className={`${ghostBtn} min-w-[3.25rem] px-4`}
          style={{ borderColor: DESIGN_BORDER }}
          onClick={() => setMenuOpen(true)}
          aria-label="更多"
        >
          更多
        </button>
        <button
          type="button"
          className={primaryBtn}
          style={{ backgroundColor: canSubmit ? themeColor : undefined }}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {primaryLabel}
        </button>
      </div>
      <div className={`pointer-events-auto mt-2 px-4 text-center ${H5_COLUMN_CLASS}`}>
        <button
          type="button"
          className="text-xs font-medium leading-relaxed text-gray-600 underline decoration-gray-300 underline-offset-2 transition hover:text-gray-800 hover:decoration-gray-400"
          onClick={() => setContactModalOpen(true)}
        >
          {CUSTOM_SHOP_CONTACT_TEASER}
        </button>
      </div>

      <CustomShopContactModal open={contactModalOpen} onClose={() => setContactModalOpen(false)} />

      <ShopMoreMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        shopSlug={shopSlug}
        projectId={projectId}
        showMyOrdersInMore={showMyOrdersInMore}
        isShopOwner={isShopOwner}
        invitedRole={invitedRole}
        copied={copied}
        onCopyLink={handleCopy}
      />
    </div>
  );
}
