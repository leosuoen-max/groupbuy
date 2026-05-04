import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { getOrderByNumber } from '../../lib/orderService';
import type { OrderDoc } from '../../types/firestore';

const statusLabel: Record<string, string> = {
  unpaid: '待付款',
  pending: '待核实',
  confirmed: '已确认付款',
  partial_paid: '待补付款',
  cancelled: '已取消',
};

export default function OrderDetail() {
  const { shopSlug = '', projectId = '', orderId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
    orderId: string;
  }>();
  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
      void getOrderByNumber(projectId, decodeURIComponent(orderId))
        .then((row) => {
          if (cancelled) return;
          if (!row || row.data.shopSlug !== shopSlug) {
            setOrder(null);
            return;
          }
          setOrder(row.data);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(toLoadErrorMessage(err, '加载订单详情失败，请重试。'));
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, projectId, shopSlug]);

  if (loading) {
    return (
      <PageShell title="订单详情" subtitle="加载中">
        <p className="text-sm text-gray-600">正在读取订单详情…</p>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="订单详情" subtitle="加载失败">
        <p className="text-sm text-red-600">{error}</p>
      </PageShell>
    );
  }

  if (!order) {
    return (
      <PageShell title="订单详情" subtitle="未找到订单">
        <p className="text-sm text-gray-600">
          可能尚未提交，或订单号不匹配。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className="text-sm text-indigo-600 underline-offset-2 hover:underline"
            to={base}
          >
            返回项目首页
          </Link>
          <Link
            className="text-sm text-indigo-600 underline-offset-2 hover:underline"
            to={`${base}/my-orders`}
          >
            我的订单
          </Link>
        </div>
      </PageShell>
    );
  }

  const created = order.createdAt?.toDate?.() ?? new Date();
  const timeStr = `${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;

  return (
    <PageShell title={`订单 #${order.orderNumber}`} subtitle={order.projectTitle}>
      <div className="space-y-4 text-sm text-gray-800">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-emerald-900">
          <div className="text-lg font-bold">#{order.orderNumber}</div>
          <p className="mt-1 text-sm">下单时间：{timeStr}</p>
          <p>配送点：{order.deliveryPointSnapshot?.name ?? '未填写'}</p>
          <p>
            状态：
            <span className="font-medium text-red-700">
              {statusLabel[order.status] ?? order.status}
            </span>
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">已选商品</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {order.lines.map((l) => (
              <li
                key={l.productId}
                className="flex justify-between gap-2 px-3 py-2"
              >
                <span>
                  {l.name} ×{l.quantity}
                </span>
                <span className="tabular-nums font-medium">
                  {formatMYR(l.unitPrice * l.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
            <span>总计</span>
            <span>{formatMYR(order.totalAmount)}</span>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">顾客信息</h2>
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-gray-800">
            <p>姓名：{order.customerName}</p>
            <p>电话：{order.customerPhone}</p>
            <p>地址：{order.customerAddress}</p>
            <p>备注：{order.customerNote ?? '（无）'}</p>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
          付款截图上传、加菜、改单等为后续功能（见 docs/03）。
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to={base}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
          >
            返回首页
          </Link>
          <Link
            to={`${base}/my-orders`}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
          >
            我的订单
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
