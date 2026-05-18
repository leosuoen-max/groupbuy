import { Link, useLocation, useNavigate } from 'react-router-dom';

type PageShellProps = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  hideBack?: boolean;
  /** 使用浏览器历史返回（文案默认「上一页」） */
  historyBack?: boolean;
  backLabel?: string;
  backHref?: string;
};

const link = 'text-indigo-600 underline-offset-2 hover:underline';

function pageBackTarget(pathname: string): { href: string; label: string } {
  if (pathname === '/admin/feituan' || pathname.startsWith('/admin/feituan/')) {
    return { href: '/admin/feituan', label: '饭团管理' };
  }
  if (pathname === '/admin/shops' || pathname === '/admin/registrations') {
    return { href: '/admin/shops', label: '平台后台' };
  }
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    return { href: '/dashboard', label: '商户后台' };
  }
  if (pathname === '/feituan' || pathname.startsWith('/feituan/')) {
    return { href: '/feituan', label: '饭团首页' };
  }
  if (pathname.startsWith('/shop/')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 3) {
      return {
        href: `/${parts.slice(0, 3).join('/')}`,
        label: '店铺首页',
      };
    }
    return { href: '/', label: '首页' };
  }
  return { href: '/', label: '商户入口' };
}

export function PageShell({
  title,
  subtitle,
  children,
  hideBack,
  historyBack = false,
  backLabel,
  backHref,
}: PageShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const back = pageBackTarget(location.pathname);
  const label = backLabel ?? (historyBack ? '上一页' : back.label);
  const href = backHref ?? back.href;

  return (
    <main className="min-h-[60vh] w-full px-4 py-5">
      {!hideBack ? (
        <p className="mb-3">
          {historyBack ? (
            <button
              type="button"
              className={`${link} cursor-pointer bg-transparent p-0`}
              onClick={() => {
                if (backHref) {
                  navigate(backHref);
                  return;
                }
                if (window.history.length > 1) {
                  navigate(-1);
                  return;
                }
                navigate(back.href);
              }}
            >
              ← {label}
            </button>
          ) : (
            <Link to={href} className={link}>
              ← {label}
            </Link>
          )}
        </p>
      ) : null}
      <h1 className="mb-2 text-xl font-semibold text-gray-900">{title}</h1>
      {subtitle ? (
        <p className="mb-4 text-sm text-gray-600">{subtitle}</p>
      ) : null}
      {children}
    </main>
  );
}
