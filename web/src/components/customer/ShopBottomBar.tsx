import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectStatus } from '../../data/mockShopHome';
import { formatMYR } from '../../lib/formatMYR';
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

  if (variant === 'dual') {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="pointer-events-auto w-full max-w-lg px-3">
          <div className="rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="flex gap-2">
              <Link
                to={`${base}/my-orders`}
                className="flex h-12 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-800 active:bg-gray-100"
              >
                我的订单
              </Link>
              <button
                type="button"
                className="flex h-12 flex-1 items-center justify-center rounded-xl px-2 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-100"
                style={{ backgroundColor: canSubmit ? themeColor : undefined }}
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                {primaryLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
      <div className="pointer-events-auto w-full max-w-lg px-3">
        <div className="rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex gap-2">
            {showMyOrdersPrimary ? (
              <Link
                to={`${base}/my-orders`}
                className="flex h-12 flex-[1.05] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 active:bg-gray-100"
              >
                我的订单
              </Link>
            ) : (
              <div
                className="flex h-12 flex-[1.05] rounded-xl border border-transparent bg-transparent"
                aria-hidden
              />
            )}
            <button
              type="button"
              className="flex h-12 min-w-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-800 active:bg-gray-50"
              onClick={() => setMenuOpen(true)}
              aria-label="更多"
            >
              更多
            </button>
            <button
              type="button"
              className="flex h-12 flex-[1.25] items-center justify-center rounded-xl px-2 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-100"
              style={{ backgroundColor: canSubmit ? themeColor : undefined }}
              disabled={!canSubmit}
              onClick={onSubmit}
            >
              {primaryLabel}
            </button>
          </div>
          <Link
            to="/register"
            className="mt-2 block text-center text-xs text-gray-500 underline-offset-2 hover:underline"
          >
            想拥有自己的店？立即免费创建 →
          </Link>
        </div>
      </div>

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
