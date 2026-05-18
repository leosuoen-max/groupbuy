import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useFeituanCartCount } from '../../hooks/useFeituanCartCount';
import { useFeituanMessageCount } from '../../hooks/useFeituanMessageCount';
import { FEITUAN_HOME } from '../../lib/feituanHomeTheme';
import { FeituanMoreSheet } from './FeituanMoreSheet';

const C = FEITUAN_HOME;

function MoreDotsIcon({ active }: { active?: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx={5} cy={12} r={active ? 2 : 1.8} />
      <circle cx={12} cy={12} r={active ? 2 : 1.8} />
      <circle cx={19} cy={12} r={active ? 2 : 1.8} />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H9l-4.2 3.15c-.55.41-1.3.02-1.3-.65V15H6.5A2.5 2.5 0 0 1 4 12.5v-7Z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
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
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x={5} y={3} width={14} height={18} rx={2} stroke="currentColor" strokeWidth={1.8} />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

function formatBadge(n: number): string {
  if (n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}


type TabItemProps = {
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  to?: string;
  children: ReactNode;
};

function TabItem({ label, active, badge, onClick, to, children }: TabItemProps) {
  const color = active ? C.primary : C.textMain;
  const inner = (
    <>
      <span className="relative inline-flex">
        <span style={{ color }}>{children}</span>
        {badge && badge > 0 ? (
          <span
            className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{ backgroundColor: '#FF5000' }}
          >
            {formatBadge(badge)}
          </span>
        ) : null}
      </span>
      <span
        className="mt-0.5 text-[11px] font-medium leading-none"
        style={{ color: active ? C.primary : C.textSub }}
      >
        {label}
      </span>
    </>
  );

  const className =
    'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1 active:opacity-70';

  if (to) {
    return (
      <Link to={to} className={className} aria-label={label} aria-current={active ? 'page' : undefined}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className} aria-label={label}>
      {inner}
    </button>
  );
}

function isCartPath(pathname: string): boolean {
  return (
    pathname === '/feituan/cart' ||
    pathname.startsWith('/feituan/cart-checkout') ||
    pathname.startsWith('/feituan/cart-payment/')
  );
}

/** 饭团底部固定 Tab 栏：更多、消息、购物车、我的订单 */
export function FeituanHomeBottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const cartCount = useFeituanCartCount();
  const messageCount = useFeituanMessageCount();
  const { pathname } = useLocation();

  const messagesActive = pathname === '/feituan/messages';
  const cartActive = isCartPath(pathname);
  const ordersActive = pathname === '/feituan/my-orders';

  return (
    <>
      <nav
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t bg-white"
        style={{
          borderColor: C.primaryBorder,
          boxShadow: C.navShadow,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        aria-label="饭团导航"
      >
        <div className="mx-auto flex h-[3.25rem] max-w-xl items-stretch px-1">
          <TabItem label="更多" onClick={() => setMoreOpen(true)}>
            <MoreDotsIcon active={moreOpen} />
          </TabItem>
          <TabItem
            label="消息"
            to="/feituan/messages"
            active={messagesActive}
            badge={messageCount}
          >
            <MessageIcon />
          </TabItem>
          <TabItem label="购物车" to="/feituan/cart" active={cartActive} badge={cartCount}>
            <CartIcon />
          </TabItem>
          <TabItem label="我的订单" to="/feituan/my-orders" active={ordersActive}>
            <OrdersIcon />
          </TabItem>
        </div>
      </nav>
      <FeituanMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
