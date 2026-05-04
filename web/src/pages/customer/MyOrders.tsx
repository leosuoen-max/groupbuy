import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { listOrdersByCustomer } from '../../lib/orderService';
import type { OrderDoc } from '../../types/firestore';

function summarizeLines(o: OrderDoc): string {
  return o.lines.map((l) => `${l.name}×${l.quantity}`).join(' + ');
}

export default function MyOrders() {
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const customerKey = getOrCreateCustomerKey();
      setLoading(true);
      setError(null);
      void listOrdersByCustomer(projectId, customerKey)
        .then((rows) => {
          if (cancelled) return;
          setOrders(
            rows
              .filter((row) => row.data.shopSlug === shopSlug)
              .map((row) => row.data)
          );
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(toLoadErrorMessage(err, '加载订单失败，请重试。'));
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, shopSlug]);

  if (loading) {
    return (
      <PageShell title="我的订单" subtitle="加载中">
        <p className="text-sm text-gray-600">正在读取订单…</p>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="我的订单" subtitle="加载失败">
        <p className="text-sm text-red-600">{error}</p>
      </PageShell>
    );
  }

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
              const t = o.createdAt?.toDate?.() ?? new Date();
              const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
              return (
                <li
                  key={`${o.orderNumber}-${t.getTime()}`}
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
