import { Link } from 'react-router-dom';
import { useFeituanCartCount } from '../../hooks/useFeituanCartCount';
import { H5_COLUMN_CLASS } from '../../lib/shopTheme';
import { formatMYR } from '../../lib/formatMYR';
import { feituanFloatNavBtnProps } from './feituanFloatNavButton';
import {
  FeituanNavBackIcon,
  FeituanNavCartIcon,
  FeituanNavMoreIcon,
  FeituanNavShareIcon,
} from './FeituanNavIcons';
import { FeituanMoreSheet } from './FeituanMoreSheet';

function formatBadge(n: number): string {
  if (n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}

type FeituanProjectTopBarProps = {
  onShare: () => void;
  moreOpen: boolean;
  onMoreOpen: () => void;
  onMoreClose: () => void;
};

export function FeituanProjectTopBar({
  onShare,
  moreOpen,
  onMoreOpen,
  onMoreClose,
}: FeituanProjectTopBarProps) {
  const cartCount = useFeituanCartCount();

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <div
          className={`pointer-events-auto mx-auto flex items-center justify-between px-3 py-1.5 ${H5_COLUMN_CLASS}`}
        >
          <Link to="/feituan" {...feituanFloatNavBtnProps()} aria-label="返回饭团主页">
            <FeituanNavBackIcon />
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              {...feituanFloatNavBtnProps()}
              aria-label="分享饭团主页"
              onClick={onShare}
            >
              <FeituanNavShareIcon />
            </button>
            <Link to="/feituan/cart" {...feituanFloatNavBtnProps()} aria-label="购物车">
              <FeituanNavCartIcon />
              {cartCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#FF5000] px-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-white/50">
                  {formatBadge(cartCount)}
                </span>
              ) : null}
            </Link>
            <button
              type="button"
              {...feituanFloatNavBtnProps()}
              aria-label="更多"
              onClick={onMoreOpen}
            >
              <FeituanNavMoreIcon />
            </button>
          </div>
        </div>
      </div>
      <FeituanMoreSheet open={moreOpen} onClose={onMoreClose} anchorAboveTabBar={false} />
    </>
  );
}

type FeituanProjectBottomBarProps = {
  themeColor: string;
  shopOpen: boolean;
  isAppendMode: boolean;
  totalQty: number;
  total: number;
  appendSubmitting: boolean;
  appendTargetReady: boolean;
  onAddToCart: () => void;
  onPay: () => void;
};

export function FeituanProjectBottomBar({
  themeColor,
  shopOpen,
  isAppendMode,
  totalQty,
  total,
  appendSubmitting,
  appendTargetReady,
  onAddToCart,
  onPay,
}: FeituanProjectBottomBarProps) {
  const canAct = shopOpen && totalQty > 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-[#ececec] bg-white pb-[calc(10px+env(safe-area-inset-bottom,0px))] pt-2.5">
      <div className={`pointer-events-auto w-full px-4 ${H5_COLUMN_CLASS}`}>
        {isAppendMode ? (
          <button
            type="button"
            className="flex min-h-[46px] w-full items-center justify-center rounded-full px-4 py-3 text-[15px] font-semibold text-white disabled:bg-gray-300"
            style={{ backgroundColor: canAct && appendTargetReady ? themeColor : undefined }}
            disabled={!canAct || appendSubmitting || !appendTargetReady}
            onClick={onPay}
          >
            {appendSubmitting
              ? '加购中…'
              : totalQty > 0
                ? `确认加购 · ${totalQty}件 · ${formatMYR(total)}`
                : '请选择商品'}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-full border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 disabled:opacity-50"
              disabled={!canAct}
              onClick={onAddToCart}
            >
              加入购物车
            </button>
            <button
              type="button"
              className="flex min-h-[46px] flex-[1.15] items-center justify-center rounded-full px-3 py-3 text-sm font-semibold text-white disabled:bg-gray-300"
              style={{ backgroundColor: canAct ? themeColor : undefined }}
              disabled={!canAct}
              onClick={onPay}
            >
              {totalQty > 0 ? `付款 ${totalQty}件 ${formatMYR(total)}` : '请选择商品'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
