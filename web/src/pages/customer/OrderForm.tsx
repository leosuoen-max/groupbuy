import { Link, useLocation, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { formatMYR } from '../../lib/formatMYR';

type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isDiscount: boolean;
};

type OrderLocationState = {
  lines?: OrderLine[] | null;
};

export default function OrderForm() {
  const { shopSlug, projectId } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const location = useLocation();
  const state = (location.state ?? {}) as OrderLocationState;
  const lines = state.lines?.filter(Boolean) ?? [];
  const base = `/shop/${encodeURIComponent(shopSlug ?? '')}/${encodeURIComponent(projectId ?? '')}`;

  return (
    <PageShell
      title="填写订单"
      subtitle={`来自首页购物车 · 后续步骤见 docs/03`}
    >
      {lines.length === 0 ? (
        <div className="space-y-3 text-sm text-gray-600">
          <p>还没有从首页带过来的选菜记录。</p>
          <Link className="text-indigo-600 underline-offset-2 hover:underline" to={base}>
            返回项目首页选菜
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {lines.map((l) => (
              <li
                key={l.productId}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="min-w-0 text-gray-900">
                  {l.name}{' '}
                  <span className="text-gray-500">×{l.quantity}</span>
                  {l.isDiscount ? (
                    <span className="ml-1 text-xs text-amber-700">早鸟</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-semibold text-gray-900">
                  {formatMYR(l.unitPrice * l.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">
            占位：下一步为填写姓名电话地址、选配送点、提交订单。
          </p>
          <Link className="text-sm text-indigo-600 underline-offset-2 hover:underline" to={base}>
            返回修改选菜
          </Link>
        </div>
      )}
    </PageShell>
  );
}
