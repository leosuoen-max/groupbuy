import { Link } from 'react-router-dom';

type PageShellProps = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
};

const link = 'text-indigo-600 underline-offset-2 hover:underline';

export function PageShell({ title, subtitle, children }: PageShellProps) {
  return (
    <main className="min-h-[60vh] w-full px-4 py-5">
      <p className="mb-3">
        <Link to="/" className={link}>
          ← 首页
        </Link>
      </p>
      <h1 className="mb-2 text-xl font-semibold text-gray-900">{title}</h1>
      {subtitle ? (
        <p className="mb-4 text-sm text-gray-600">{subtitle}</p>
      ) : null}
      {children}
    </main>
  );
}
