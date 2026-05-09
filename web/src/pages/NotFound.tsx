import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="w-full px-4 py-5">
      <h1 className="mb-3 text-xl font-semibold text-gray-900">页面不存在</h1>
      <p>
        <Link
          className="text-indigo-600 underline-offset-2 hover:underline"
          to="/"
        >
          返回首页
        </Link>
      </p>
    </main>
  );
}
