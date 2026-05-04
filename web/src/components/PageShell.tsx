import { Link } from 'react-router-dom';

type PageShellProps = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export function PageShell({ title, subtitle, children }: PageShellProps) {
  return (
    <main
      style={{
        padding: '1.25rem',
        maxWidth: 720,
        margin: '0 auto',
        minHeight: '60vh',
      }}
    >
      <p style={{ margin: '0 0 12px' }}>
        <Link to="/">← 首页</Link>
      </p>
      <h1
        style={{
          fontSize: '1.35rem',
          color: 'var(--text-h)',
          margin: '0 0 8px',
        }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p style={{ margin: '0 0 16px', opacity: 0.88 }}>{subtitle}</p>
      ) : null}
      {children}
    </main>
  );
}
