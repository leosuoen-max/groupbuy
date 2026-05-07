import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { listOrdersByCustomer } from '../../lib/orderService';
import { orderHasPaymentScreenshots } from '../../lib/paymentScreenshotHelpers';
import type { OrderDoc, OrderStatus } from '../../types/firestore';

function summarizeLines(o: OrderDoc): string {
  return o.lines.map((l) => `${l.name}×${l.quantity}`).join(' + ');
}

const statusLabel: Record<string, string> = {
  unpaid: '待付款',
  pending: '待确认',
  confirmed: '已确认付款',
  partial_paid: '待付款',
  cancelled: '已取消',
};

const statusCard: Record<
  string,
  { border: string; surface: string; pill: string }
> = {
  unpaid: {
    border: 'border-l-amber-500',
    surface: 'bg-amber-50/80',
    pill: 'bg-amber-100 text-amber-900',
  },
  pending: {
    border: 'border-l-indigo-500',
    surface: 'bg-indigo-50/80',
    pill: 'bg-indigo-100 text-indigo-900',
  },
  partial_paid: {
    border: 'border-l-orange-500',
    surface: 'bg-orange-50/80',
    pill: 'bg-orange-100 text-orange-900',
  },
  confirmed: {
    border: 'border-l-emerald-500',
    surface: 'bg-emerald-50/80',
    pill: 'bg-emerald-100 text-emerald-900',
  },
  cancelled: {
    border: 'border-l-gray-400',
    surface: 'bg-gray-50',
    pill: 'bg-gray-200 text-gray-700',
  },
};

function cardClasses(status: OrderStatus): string {
  const s = statusCard[status] ?? {
    border: 'border-l-gray-400',
    surface: 'bg-white',
    pill: 'bg-gray-100 text-gray-800',
  };
  return `rounded-xl border border-gray-100 border-l-4 ${s.border} ${s.surface} px-3 py-3 shadow-sm`;
}

function uploadHint(o: OrderDoc): { text: string; className: string } | null {
  const hasShot = orderHasPaymentScreenshots(o.paymentScreenshots);
  if (o.status === 'cancelled') return null;
  if (hasShot) {
    return { text: '已传付款截图', className: 'text-emerald-700' };
  }
  if (
    o.status === 'unpaid' ||
    o.status === 'pending' ||
    o.status === 'partial_paid'
  ) {
    return { text: '未传付款截图', className: 'text-gray-500' };
  }
  return null;
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
              const st = o.status;
              const styles = statusCard[st] ?? statusCard.unpaid;
              const upload = uploadHint(o);
              return (
                <li
                  key={`${o.orderNumber}-${t.getTime()}`}
                  className={cardClasses(st)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900">
                          订单 #{o.orderNumber}{' '}
                          <span className="font-normal text-gray-500">{hm}</span>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles.pill}`}
                        >
                          {statusLabel[st] ?? st}
                        </span>
                        {upload ? (
                          <span
                            className={`text-[11px] font-medium ${upload.className}`}
                          >
                            {upload.text}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                        {summarizeLines(o)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        总计 {formatMYR(o.totalAmount)}
                      </p>
                      {(Number(o.paidAmount) > 0 ||
                        Number(o.pendingAmount) > 0) &&
                      o.status !== 'cancelled' ? (
                        o.status === 'pending' ? (
                          <p className="mt-0.5 text-[11px] text-gray-600">
                            已支付 {formatMYR(Number(o.pendingAmount) || 0)}，待确认 · 待支付 RM 0
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-gray-600">
                            已付 {formatMYR(Number(o.paidAmount) || 0)} · 待付{' '}
                            {formatMYR(Number(o.pendingAmount) || 0)}
                          </p>
                        )
                      ) : null}
                      {o.status === 'unpaid' && o.timedPromoPaymentDueAt ? (
                        <p className="mt-0.5 text-[11px] text-amber-700">
                          含限时优惠，请在30分钟内付款（截止{' '}
                          {o.timedPromoPaymentDueAt.toDate().toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                          ）
                        </p>
                      ) : null}
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
