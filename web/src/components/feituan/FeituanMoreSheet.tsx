import { Link } from 'react-router-dom';
import { FEITUAN_HOME } from '../../lib/feituanHomeTheme';
import { FEITUAN_TAB_BAR_OFFSET } from '../../lib/feituanBottomNav';

const C = FEITUAN_HOME;

type Props = {
  open: boolean;
  onClose: () => void;
  /** 为 true 时弹层在底部 Tab 栏之上（饭团首页等） */
  anchorAboveTabBar?: boolean;
};

export function FeituanMoreSheet({
  open,
  onClose,
  anchorAboveTabBar = true,
}: Props) {
  if (!open) return null;

  const links = [
    { to: '/feituan', label: '饭团首页' },
    { to: '/feituan/wallet', label: '饭团钱包' },
    { to: '/feituan/account', label: '账号中心' },
  ] as const;

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] bg-black/25">
      <button
        type="button"
        className="absolute inset-0 h-full w-full"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className="absolute inset-x-0 mx-auto w-full max-w-xl rounded-t-2xl bg-white p-4 shadow-2xl"
        style={{ bottom: anchorAboveTabBar ? FEITUAN_TAB_BAR_OFFSET : 0 }}
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
