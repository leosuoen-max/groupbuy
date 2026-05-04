import { Link } from 'react-router-dom';
import type { ProjectStatus } from '../../data/mockShopHome';
import { formatMYR } from '../../lib/formatMYR';

type ShopBottomBarProps = {
  shopSlug: string;
  projectId: string;
  themeColor: string;
  projectStatus: ProjectStatus;
  totalQty: number;
  totalAmount: number;
  onSubmit: () => void;
};

export function ShopBottomBar({
  shopSlug,
  projectId,
  themeColor,
  projectStatus,
  totalQty,
  totalAmount,
  onSubmit,
}: ShopBottomBarProps) {
  const base = '/shop/' + encodeURIComponent(shopSlug) + '/' + encodeURIComponent(projectId);
  const closed = projectStatus === 'closed' || projectStatus === 'full';
  const canSubmit = !closed && totalQty > 0;

  let primaryLabel = '请先选择商品';
  if (closed) primaryLabel = '已截止';
  else if (totalQty > 0) {
    primaryLabel = `点此提交 · ${totalQty} 件 · ${formatMYR(totalAmount)}`;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
      <div className="pointer-events-auto w-full max-w-lg px-3">
        <div className="rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex gap-2">
            <Link
              to={`${base}/my-orders`}
              className="flex h-12 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 active:bg-gray-100"
            >
              我的订单
            </Link>
            <button
              type="button"
              className="flex h-12 flex-[1.35] items-center justify-center rounded-xl px-2 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-100"
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
    </div>
  );
}
