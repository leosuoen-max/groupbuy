import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { formatMYR } from '../../lib/formatMYR';
import { loadMockOrders } from '../../lib/mockOrderStorage';
import type { StoredMockOrder } from '../../types/orderDraft';

function summarizeLines(o: StoredMockOrder): string {
  return o.lines.map((l) => `${l.name}×${l.quantity}`).join(' + ');
}

export default function MyOrders() {
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;

  const orders = loadMockOrders().filter(
    (o) => o.shopSlug === shopSlug && o.projectId === projectId
  );

  return (
    <PageShell title="我的订单" subtitle={orders.length ? `共 ${orders.length} 单` : '暂无订单'}>
      {orders.length === 0 ? (
        <div className="space-y-3 text-sm text-gray-600">
          <p>还没有订单，先下一单吧。</p>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white"
            to={base}
          >
            去选菜下单
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3">
            {orders.map((o) => {
              const t = new Date(o.createdAt);
              const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
              return (
                <li
                  key={`${o.orderNumber}-${o.createdAt}`}
                  className="rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900">
                        订单 #{o.orderNumber}{' '}
                        <span className="font-normal text-gray-500">{hm}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                        {summarizeLines(o)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        总计 {formatMYR(o.totalAmount)}
                      </p>
                    </div>
                    <Link
                      to={`${base}/orders/${encodeURIComponent(o.orderNumber)}`}
                      className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      查看详情
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link
            to={base}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-gray-300 text-sm font-medium text-gray-800"
          >
            + 下新订单
          </Link>
        </div>
      )}
    </PageShell>
  );
}
