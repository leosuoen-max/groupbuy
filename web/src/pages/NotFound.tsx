import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main style={{ padding: '1.25rem', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ color: 'var(--text-h)' }}>页面不存在</h1>
      <p>
        <Link to="/">返回首页</Link>
      </p>
    </main>
  );
}
