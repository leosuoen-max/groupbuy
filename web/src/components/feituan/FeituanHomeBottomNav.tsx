import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useFeituanCartCount } from '../../hooks/useFeituanCartCount';
import { FEITUAN_HOME } from '../../lib/feituanHomeTheme';

const C = FEITUAN_HOME;

function MoreDotsIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx={5} cy={12} r={1.8} />
      <circle cx={12} cy={12} r={1.8} />
      <circle cx={19} cy={12} r={1.8} />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6h15l-1.5 9h-11L6 6z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M6 6L5 3H2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={9} cy={20} r={1.5} fill="currentColor" />
      <circle cx={17} cy={20} r={1.5} fill="currentColor" />
    </svg>
  );
}

function OrdersIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x={5} y={3} width={14} height={18} rx={2} stroke="currentColor" strokeWidth={1.8} />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={16.5} cy={16.5} r={2.5} fill="currentColor" />
    </svg>
  );
}

type FeituanMoreSheetProps = {
  open: boolean;
  onClose: () => void;
};

function FeituanMoreSheet({ open, onClose }: FeituanMoreSheetProps) {
  if (!open) return null;

  const links = [
    { to: '/feituan/wallet', label: '饭团钱包' },
    { to: '/feituan/account', label: '账号中心' },
  ] as const;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 bg-black/25">
      <button
        type="button"
        className="absolute inset-0 h-full w-full"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-xl rounded-t-2xl bg-white p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feituan-more-title"
      >
        <p id="feituan-more-title" className="mb-3 text-center text-sm font-semibold text-gray-900">
          更多
        </p>
        <div className="space-y-2">
          {links.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="flex w-full items-center justify-center rounded-xl border py-3 text-sm font-semibold active:bg-gray-50"
              style={{ borderColor: C.primaryBorder, color: C.primary }}
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl py-2.5 text-sm text-gray-600 active:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

type FloatingActionProps = {
  label: string;
  onClick?: () => void;
  to?: string;
  children: ReactNode;
};

function FloatingAction({ label, onClick, to, children }: FloatingActionProps) {
  const circleClass =
    'flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/82 text-gray-800 shadow-[0_2px_12px_rgba(15,143,95,0.14)] backdrop-blur-sm active:scale-95';

  const inner = to ? (
    <Link to={to} className={circleClass} aria-label={label}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={circleClass} aria-label={label}>
      {children}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-1">
      {inner}
      <span className="text-[10px] font-medium leading-none" style={{ color: C.textSub }}>
        {label}
      </span>
    </div>
  );
}

/** 右下角悬浮：更多 + 我的订单 */
export function FeituanHomeBottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const cartCount = useFeituanCartCount();

  return (
    <>
      <nav
        className="pointer-events-none fixed right-3 z-40 flex flex-col items-center gap-4"
        style={{ bottom: 'max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))' }}
        aria-label="快捷操作"
      >
        <div className="pointer-events-auto relative">
          <FloatingAction label="购物车" to="/feituan/cart">
            <CartIcon />
          </FloatingAction>
          {cartCount > 0 ? (
            <span
              className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
              style={{ backgroundColor: FEITUAN_HOME.primary }}
            >
              {cartCount > 9 ? '9+' : cartCount}
            </span>
          ) : null}
        </div>
        <div className="pointer-events-auto">
          <FloatingAction label="更多" onClick={() => setMoreOpen(true)}>
            <MoreDotsIcon />
          </FloatingAction>
        </div>
        <div className="pointer-events-auto">
          <FloatingAction label="我的订单" to="/feituan/my-orders">
            <OrdersIcon />
          </FloatingAction>
        </div>
      </nav>
      <FeituanMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
