import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeituanHomeBottomNav } from '../components/feituan/FeituanHomeBottomNav';
import { FeituanHomePageHeader } from '../components/feituan/FeituanHomePageHeader';
import { useAuthUser } from '../hooks/useAuthUser';
import { notifyFeituanMessagesUpdated } from '../hooks/useFeituanMessageCount';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { feituanPageBottomPaddingClass } from '../lib/feituanBottomNav';
import { toLoadErrorMessage } from '../lib/firebaseErrorMessage';
import { FEITUAN_HOME } from '../lib/feituanHomeTheme';
import {
  listFeituanMessages,
  loadSeenNotifyOrderIds,
  markNotifyOrderIdsSeen,
  partitionFeituanMessages,
  shouldShowOrangeMarker,
  type FeituanMessageItem,
} from '../lib/feituanMessages';
import { listFeituanOrdersForCustomer, type OrderRow } from '../lib/orderService';
import { getWechatNotifyOAuthStateId } from '../lib/wechatService';

const C = FEITUAN_HOME;
const ORANGE = C.warning;

function OrangeMarker() {
  return (
    <span
      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: ORANGE }}
      aria-hidden
    />
  );
}

function MessageCard({
  msg,
  showOrange,
}: {
  msg: FeituanMessageItem;
  showOrange: boolean;
}) {
  return (
    <Link
      to={msg.href}
      state={{ returnTo: '/feituan/messages' }}
      className="flex gap-2.5 rounded-2xl border bg-white px-3.5 py-3 active:bg-gray-50"
      style={{
        borderColor: showOrange ? C.warningBorder : C.primaryBorder,
        backgroundColor: showOrange ? C.warningLight : C.card,
      }}
    >
      {showOrange ? <OrangeMarker /> : <span className="w-2 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{msg.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">{msg.body}</p>
      </div>
    </Link>
  );
}

export default function FeituanMessages() {
  useWechatNotifySession();
  const { user, loading: authLoading } = useAuthUser();
  const customerKey = useMemo(() => getOrCreateCustomerKey(), []);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seenNotifyIds, setSeenNotifyIds] = useState(() =>
    loadSeenNotifyOrderIds(customerKey)
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
      void listFeituanOrdersForCustomer({
        customerKey,
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
  }, [authLoading, user, customerKey]);

  useEffect(() => {
    return () => {
      const items = listFeituanMessages(rowsRef.current);
      const { notifies } = partitionFeituanMessages(items);
      markNotifyOrderIdsSeen(
        customerKey,
        notifies.map((n) => n.orderId)
      );
      notifyFeituanMessagesUpdated();
    };
  }, [customerKey]);

  const { todos, notifies, tabBadge } = useMemo(() => {
    const items = listFeituanMessages(rows);
    const parts = partitionFeituanMessages(items);
    const unreadNotify = parts.notifies.filter((n) => !seenNotifyIds.has(n.orderId));
    return {
      todos: parts.todos,
      notifies: parts.notifies,
      tabBadge: parts.todos.length + unreadNotify.length,
    };
  }, [rows, seenNotifyIds]);

  useEffect(() => {
    setSeenNotifyIds(loadSeenNotifyOrderIds(customerKey));
  }, [rows, customerKey]);

  return (
    <main
      className={`min-h-svh ${feituanPageBottomPaddingClass}`}
      style={{ backgroundColor: C.primaryBg }}
    >
      <FeituanHomePageHeader />
      <div className="px-4 pt-1">
        <h2 className="mb-3 text-base font-bold" style={{ color: C.textMain }}>
          消息
          {tabBadge > 0 ? (
            <span className="ml-2 text-sm font-medium" style={{ color: ORANGE }}>
              {tabBadge}
            </span>
          ) : null}
        </h2>

        {loading ? (
          <p className="text-sm" style={{ color: C.textSub }}>
            加载中…
          </p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

        {!loading && !error && todos.length === 0 && notifies.length === 0 ? (
          <div
            className="rounded-3xl border border-dashed px-4 py-12 text-center text-sm"
            style={{
              borderColor: C.primaryBorder,
              backgroundColor: C.card,
              color: C.textSub,
            }}
          >
            <p>暂无消息</p>
            <p className="mt-2 text-xs">待付款与订单动态会显示在这里</p>
            <Link
              to="/feituan"
              className="mt-4 inline-block font-semibold"
              style={{ color: C.primary }}
            >
              去饭团逛逛
            </Link>
          </div>
        ) : null}

        {!loading && !error && (todos.length > 0 || notifies.length > 0) ? (
          <div className="space-y-4">
            {todos.length > 0 ? (
              <section>
                <h3
                  className="mb-2 text-xs font-bold uppercase tracking-wide"
                  style={{ color: ORANGE }}
                >
                  待付款（{todos.length}）
                </h3>
                <ul className="space-y-2">
                  {todos.map((msg) => (
                    <li key={msg.orderId}>
                      <MessageCard msg={msg} showOrange />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {notifies.length > 0 ? (
              <section>
                <h3
                  className="mb-2 text-xs font-bold tracking-wide"
                  style={{ color: C.textSub }}
                >
                  订单动态
                </h3>
                <ul className="space-y-2">
                  {notifies.map((msg) => (
                    <li key={msg.orderId}>
                      <MessageCard
                        msg={msg}
                        showOrange={shouldShowOrangeMarker(msg, seenNotifyIds)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
      <FeituanHomeBottomNav />
    </main>
  );
}
