import { Link } from 'react-router-dom';
import { CUSTOM_SHOP_CONTACT_TEASER, getCustomShopContactLine } from '../../config/siteContact';
import { H5_COLUMN_CLASS } from '../../lib/shopTheme';

export type ShopMoreMenuSheetProps = {
  open: boolean;
  onClose: () => void;
  shopSlug: string;
  projectId: string;
  showMyOrdersInMore: boolean;
  isShopOwner: boolean;
  invitedRole: 'normal_admin' | 'high_admin' | null;
  copied: boolean;
  onCopyLink: () => void;
  /** 店铺上架优惠卡时在「更多」中显示钱包 / 优惠卡入口（原首页横条已移除） */
  showCardsEntry?: boolean;
};

export function ShopMoreMenuSheet({
  open,
  onClose,
  shopSlug,
  projectId,
  showMyOrdersInMore,
  isShopOwner,
  invitedRole,
  copied,
  onCopyLink,
  showCardsEntry = false,
}: ShopMoreMenuSheetProps) {
  if (!open) return null;

  const base = '/shop/' + encodeURIComponent(shopSlug) + '/' + encodeURIComponent(projectId);
  const dashboardBase = '/dashboard/' + encodeURIComponent(shopSlug);
  const showAdminSection = Boolean(isShopOwner || invitedRole);
  const canEditProject = Boolean(isShopOwner || invitedRole === 'high_admin');
  const canShopSettings = Boolean(isShopOwner || invitedRole === 'high_admin');

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 bg-black/25">
      <button type="button" className="absolute inset-0 h-full w-full" aria-label="关闭更多菜单" onClick={onClose} />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto w-full rounded-t-2xl bg-white p-4 shadow-2xl ${H5_COLUMN_CLASS}`}
      >
        <div className="mb-2 text-center text-sm font-semibold text-gray-900">更多</div>
        <div className="space-y-1 text-sm">
          <Link
            to={base}
            onClick={onClose}
            className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
          >
            🏠 商户首页
          </Link>
          {showMyOrdersInMore ? (
            <Link
              to={`${base}/my-orders`}
              onClick={onClose}
              className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
            >
              📋 我的订单
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onCopyLink}
            className="block w-full rounded-lg px-3 py-2 text-left text-gray-800 hover:bg-gray-50"
          >
            🔗 复制链接 {copied ? '（已复制）' : ''}
          </button>
          {showCardsEntry ? (
            <Link
              to={`/shop/${encodeURIComponent(shopSlug)}/cards?from=${encodeURIComponent(projectId)}`}
              onClick={onClose}
              className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
            >
              💳 钱包 / 优惠卡
            </Link>
          ) : null}
          <a
            href={`mailto:?subject=${encodeURIComponent('意见反馈')}&body=${encodeURIComponent(`页面：${window.location.href}`)}`}
            className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
          >
            💬 意见反馈
          </a>
        </div>
        {showAdminSection ? (
          <>
            <div className="my-2 border-t border-gray-100" />
            <div className="mb-1 px-1 text-xs font-semibold text-gray-500">管理</div>
            <div className="space-y-1 text-sm">
              <Link
                to={dashboardBase}
                onClick={onClose}
                className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
              >
                📊 实时数据
              </Link>
              <Link
                to={`${dashboardBase}/orders`}
                onClick={onClose}
                className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
              >
                📋 订单管理
              </Link>
              {canEditProject ? (
                <Link
                  to={`${dashboardBase}/projects/${encodeURIComponent(projectId)}`}
                  onClick={onClose}
                  className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
                >
                  ✏️ 编辑菜单
                </Link>
              ) : null}
              {canEditProject ? (
                <Link
                  to={`${dashboardBase}/projects/${encodeURIComponent(projectId)}`}
                  onClick={onClose}
                  className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
                >
                  ⚙️ 项目设置
                </Link>
              ) : null}
              {isShopOwner && canShopSettings ? (
                <Link
                  to={`${dashboardBase}/settings`}
                  onClick={onClose}
                  className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
                >
                  ⚙️ 基本设置
                </Link>
              ) : null}
              {isShopOwner ? (
                <Link
                  to={`${dashboardBase}/admins`}
                  onClick={onClose}
                  className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
                >
                  👥 管理员管理
                </Link>
              ) : null}
              <Link
                to={dashboardBase}
                onClick={onClose}
                className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
              >
                🔄 切换到商户后台
              </Link>
            </div>
          </>
        ) : null}
        <div className="my-2 border-t border-gray-100" />
        <details className="group rounded-lg bg-emerald-50/60 px-3 py-2 text-sm text-emerald-950 open:pb-3">
          <summary className="flex cursor-pointer list-none items-baseline gap-0.5 font-medium outline-none [&::-webkit-details-marker]:hidden">
            <span>{CUSTOM_SHOP_CONTACT_TEASER}</span>
            <span
              className="inline-block text-[0.95em] font-normal leading-none text-emerald-700 transition-transform duration-200 group-open:rotate-90"
              aria-hidden
            >
              ›
            </span>
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-words border-t border-emerald-100/80 pt-2 text-xs leading-relaxed text-emerald-900">
            {getCustomShopContactLine()}
          </div>
        </details>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
