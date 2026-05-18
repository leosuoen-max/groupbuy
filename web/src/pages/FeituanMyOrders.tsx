import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FeituanHomeBottomNav } from '../components/feituan/FeituanHomeBottomNav';
import { PageShell } from '../components/PageShell';
import { feituanPageBottomPaddingClass } from '../lib/feituanBottomNav';
import { notifyFeituanMessagesUpdated } from '../hooks/useFeituanMessageCount';
import { useAuthUser } from '../hooks/useAuthUser';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { formatOrderDeliveryTimeDisplay } from '../lib/deliverySlot';
import { toLoadErrorMessage } from '../lib/firebaseErrorMessage';
import { formatMYR } from '../lib/formatMYR';
import { buildPaymentGroups } from '../lib/paymentGroups';
import { deriveDisplayOrderStatus, sumGroupAmountByStatus } from '../lib/paymentGroupView';
import { orderHasPaymentScreenshots } from '../lib/paymentScreenshotHelpers';
import { listFeituanOrdersForCustomer, type OrderRow } from '../lib/orderService';
import { getProject } from '../lib/projectService';
import { getWechatNotifyOAuthStateId } from '../lib/wechatService';
import { FEITUAN_TW } from '../lib/feituanHomeTheme';
import type { OrderDoc, OrderStatus, ProjectDoc } from '../types/firestore';

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
    border: FEITUAN_TW.confirmedBorder,
    surface: FEITUAN_TW.confirmedSurface,
    pill: FEITUAN_TW.confirmedPill,
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
  const displayStatus = deriveDisplayOrderStatus(o);
  if (o.status === 'cancelled') return null;
  if (hasShot) {
    return { text: '已传付款截图', className: FEITUAN_TW.hint };
  }
  if (
    displayStatus === 'unpaid' ||
    displayStatus === 'pending' ||
    displayStatus === 'partial_paid'
  ) {
    return { text: '未传付款截图', className: 'text-gray-500' };
  }
  return null;
}

function orderListDeliveryLabel(
  order: OrderDoc,
  project: ProjectDoc | undefined
): string {
  const text = formatOrderDeliveryTimeDisplay(order, project ?? null);
  if (!text || text === '—') return '';
  return text.replace(/（按付款时间确认）$/, '');
}

export default function FeituanMyOrders() {
  useWechatNotifySession();
  const { user, loading: authLoading } = useAuthUser();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, ProjectDoc>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectIdsKey = useMemo(
    () => [...new Set(rows.map((r) => r.data.projectId))].sort().join(','),
    [rows]
  );

  useEffect(() => {
    if (!projectIdsKey) {
      setProjectsById({});
      return;
    }
    const ids = projectIdsKey.split(',');
    let cancelled = false;
    void Promise.all(ids.map((id) => getProject(id))).then((results) => {
      if (cancelled) return;
      const map: Record<string, ProjectDoc> = {};
      results.forEach((row, i) => {
        if (row) map[ids[i]!] = row.data;
      });
      setProjectsById(map);
    });
    return () => {
      cancelled = true;
    };
  }, [projectIdsKey]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
      void listFeituanOrdersForCustomer({
        customerKey: getOrCreateCustomerKey(),
        customerUserId: user?.phoneNumber ? user.uid : undefined,
        wechatNotifyOAuthStateId: getWechatNotifyOAuthStateId(),
      })
        .then((nextRows) => {
          if (!cancelled) setRows(nextRows);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(toLoadErrorMessage(err, '加载饭团订单失败，请重试。'));
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            notifyFeituanMessagesUpdated();
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const shell = (children: ReactNode, subtitle: string) => (
    <div className={feituanPageBottomPaddingClass}>
      <PageShell title="我的饭团订单" subtitle={subtitle}>
        {children}
      </PageShell>
      <FeituanHomeBottomNav />
    </div>
  );

  if (loading) {
    return shell(<p className="text-sm text-gray-600">正在读取订单…</p>, '加载中');
  }

  if (error) {
    return shell(<p className="text-sm text-red-600">{error}</p>, '加载失败');
  }

  return shell(
    <>
      {rows.length === 0 ? (
        <div className="space-y-3 text-sm text-gray-600">
          <p>还没有饭团订单。微信里从服务号进入饭团下单后，这里会显示你的订单。</p>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white"
            to="/feituan"
          >
            去大马饭团
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3">
            {rows.map(({ id, data: o }) => {
              const t = o.createdAt?.toDate?.() ?? new Date();
              const dateText = t.toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              });
              const st = deriveDisplayOrderStatus(o);
              const groups = buildPaymentGroups(o);
              const confirmedAmount = sumGroupAmountByStatus(groups, 'confirmed');
              const unpaidAmount = sumGroupAmountByStatus(groups, 'unpaid');
              const styles = statusCard[st] ?? statusCard.unpaid;
              const upload = uploadHint(o);
              const deliveryLabel = orderListDeliveryLabel(
                o,
                projectsById[o.projectId]
              );
              const showPaymentFooter =
                (confirmedAmount > 0 || unpaidAmount > 0) &&
                o.status !== 'cancelled';
              return (
                <li key={id} className={cardClasses(st)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900">
                          订单 #{o.orderNumber}{' '}
                          <span className="font-normal text-gray-500">{dateText}</span>
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles.pill}`}>
                          {statusLabel[st] ?? st}
                        </span>
                        {upload ? (
                          <span className={`text-[11px] font-medium ${upload.className}`}>
                            {upload.text}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs font-medium text-gray-700">
                        {o.projectTitle || '饭团项目'}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-600">{summarizeLines(o)}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        总计 {formatMYR(o.totalAmount)}
                      </p>
                      {showPaymentFooter || deliveryLabel ? (
                        <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] leading-tight">
                          <span className="min-w-0 truncate text-gray-600">
                            {showPaymentFooter
                              ? `已付 ${formatMYR(confirmedAmount)} · 待付 ${formatMYR(unpaidAmount)}`
                              : null}
                          </span>
                          {deliveryLabel ? (
                            <span className="max-w-[58%] shrink-0 truncate text-right text-gray-500">
                              配送 {deliveryLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <Link
                      to={`/feituan/projects/${encodeURIComponent(o.projectId)}/orders/${encodeURIComponent(o.orderNumber)}`}
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
            to="/feituan"
            className="flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-gray-300 text-sm font-medium text-gray-800"
          >
            + 继续逛饭团
          </Link>
        </div>
      )}
    </>,
    rows.length ? `共 ${rows.length} 单` : '暂无订单'
  );
}
