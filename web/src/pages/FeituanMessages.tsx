import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeituanHomeBottomNav } from '../components/feituan/FeituanHomeBottomNav';
import { FeituanHomePageHeader } from '../components/feituan/FeituanHomePageHeader';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  notifyFeituanMessagesUpdated,
} from '../hooks/useFeituanMessageCount';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { feituanPageBottomPaddingClass } from '../lib/feituanBottomNav';
import { toLoadErrorMessage } from '../lib/firebaseErrorMessage';
import { formatMYR } from '../lib/formatMYR';
import { FEITUAN_HOME } from '../lib/feituanHomeTheme';
import { deriveDisplayOrderStatus } from '../lib/paymentGroupView';
import { orderHasPaymentScreenshots } from '../lib/paymentScreenshotHelpers';
import { listFeituanOrdersForCustomer, type OrderRow } from '../lib/orderService';
import { getWechatNotifyOAuthStateId } from '../lib/wechatService';
import type { OrderDoc } from '../types/firestore';

type MessageItem = {
  orderId: string;
  order: OrderDoc;
  title: string;
  body: string;
  href: string;
  tone: 'pay' | 'proof';
};

function buildMessageItem(row: OrderRow): MessageItem | null {
  const o = row.data;
  if (o.status === 'cancelled') return null;
  const display = deriveDisplayOrderStatus(o);
  const pending = Number(o.pendingAmount ?? 0);
  const hasShot = orderHasPaymentScreenshots(o.paymentScreenshots);
  const href = `/feituan/projects/${encodeURIComponent(o.projectId)}/orders/${encodeURIComponent(o.orderNumber)}`;

  if (
    (display === 'unpaid' || display === 'partial_paid' || pending > 0.0001) &&
    !hasShot
  ) {
    return {
      orderId: row.id,
      order: o,
      title: `订单 #${o.orderNumber} 待付款`,
      body: `${o.projectTitle || '饭团项目'} · 待付 ${formatMYR(pending > 0 ? pending : o.totalAmount)}，请付款或上传截图`,
      href,
      tone: 'pay',
    };
  }

  if (
    (display === 'unpaid' || display === 'partial_paid') &&
    hasShot &&
    pending > 0.0001
  ) {
    return {
      orderId: row.id,
      order: o,
      title: `订单 #${o.orderNumber} 待付尾款`,
      body: `${o.projectTitle || '饭团项目'} · 仍有 ${formatMYR(pending)} 待付`,
      href,
      tone: 'pay',
    };
  }

  if (display === 'pending' && hasShot) {
    return {
      orderId: row.id,
      order: o,
      title: `订单 #${o.orderNumber} 待确认`,
      body: `${o.projectTitle || '饭团项目'} · 已传付款截图，等待确认`,
      href,
      tone: 'proof',
    };
  }

  return null;
}

export default function FeituanMessages() {
  useWechatNotifySession();
  const { user, loading: authLoading } = useAuthUser();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        .then((next) => {
          if (!cancelled) setRows(next);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(toLoadErrorMessage(err, '加载消息失败，请重试。'));
          }
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

  const messages = useMemo(
    () =>
      rows
        .map(buildMessageItem)
        .filter((x): x is MessageItem => Boolean(x)),
    [rows]
  );

  return (
    <main
      className={`min-h-svh ${feituanPageBottomPaddingClass}`}
      style={{ backgroundColor: FEITUAN_HOME.primaryBg }}
    >
      <FeituanHomePageHeader />
      <div className="px-4 pt-1">
        <h2 className="mb-3 text-base font-bold" style={{ color: FEITUAN_HOME.textMain }}>
          消息
          {messages.length > 0 ? (
            <span className="ml-2 text-sm font-medium" style={{ color: FEITUAN_HOME.primary }}>
              {messages.length}
            </span>
          ) : null}
        </h2>

        {loading ? (
          <p className="text-sm" style={{ color: FEITUAN_HOME.textSub }}>
            加载中…
          </p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

        {!loading && !error && messages.length === 0 ? (
          <div
            className="rounded-3xl border border-dashed px-4 py-12 text-center text-sm"
            style={{
              borderColor: FEITUAN_HOME.primaryBorder,
              backgroundColor: FEITUAN_HOME.card,
              color: FEITUAN_HOME.textSub,
            }}
          >
            <p>暂无待处理消息</p>
            <p className="mt-2 text-xs">付款提醒、待确认订单会显示在这里</p>
            <Link
              to="/feituan"
              className="mt-4 inline-block font-semibold"
              style={{ color: FEITUAN_HOME.primary }}
            >
              去饭团逛逛
            </Link>
          </div>
        ) : null}

        <ul className="space-y-2">
          {messages.map((msg) => (
            <li key={msg.orderId}>
              <Link
                to={msg.href}
                className="block rounded-2xl border bg-white px-3.5 py-3 active:bg-gray-50"
                style={{ borderColor: FEITUAN_HOME.primaryBorder }}
              >
                <p className="text-sm font-semibold text-gray-900">{msg.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">{msg.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <FeituanHomeBottomNav />
    </main>
  );
}
