import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  getOrderByNumber,
  merchantAppendInternalNote,
  merchantConfirmPayment,
  type OrderRow,
} from '../../lib/orderService';
import type { OrderDoc } from '../../types/firestore';

const statusLabel: Record<string, string> = {
  unpaid: '待付款',
  pending: '待核实',
  confirmed: '已确认付款',
  partial_paid: '待补付款',
  cancelled: '已取消',
};

function isNoteEntry(
  x: unknown
): x is { body: string; userId: string; createdAt: { toDate: () => Date } } {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const ca = o.createdAt as { toDate?: () => Date } | undefined;
  return (
    typeof o.body === 'string' &&
    typeof o.userId === 'string' &&
    typeof ca?.toDate === 'function'
  );
}

export default function MerchantOrderDetail() {
  const { shopSlug = '', projectId = '', orderNumber = '' } = useParams<{
    shopSlug: string;
    projectId: string;
    orderNumber: string;
  }>();
  const slug = decodeURIComponent(shopSlug);
  const pid = decodeURIComponent(projectId);
  const onum = decodeURIComponent(orderNumber);

  const { user, loading: authLoading } = useAuthUser();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<OrderRow | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'note' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await getOrderByNumber(pid, onum);
      if (!r || r.data.shopSlug !== slug) {
        setRow(null);
        setErr('订单不存在或不属于当前店铺');
        return;
      }
      setRow(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [onum, pid, slug]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handleConfirm = async () => {
    if (!user || !row) return;
    setBusy('confirm');
    setMsg(null);
    try {
      await merchantConfirmPayment(row.id, user.uid);
      setMsg('已确认收款');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleNote = async () => {
    if (!user || !row) return;
    setBusy('note');
    setMsg(null);
    try {
      await merchantAppendInternalNote(row.id, user.uid, noteDraft);
      setNoteDraft('');
      setMsg('备注已保存');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(null);
    }
  };

  const baseOrders = `/dashboard/${encodeURIComponent(slug)}/orders`;
  const customerUrl = `/shop/${encodeURIComponent(slug)}/${encodeURIComponent(pid)}/orders/${encodeURIComponent(onum)}`;

  if (authLoading || loading) {
    return (
      <PageShell title="订单详情" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="订单详情" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/login">
          登录
        </Link>
      </PageShell>
    );
  }

  if (err || !row) {
    return (
      <PageShell title="订单详情" subtitle="错误">
        <p className="text-sm text-red-600">{err ?? '未找到订单'}</p>
        <Link
          to={baseOrders}
          className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline"
        >
          返回订单列表
        </Link>
      </PageShell>
    );
  }

  const order: OrderDoc = row.data;
  const created = order.createdAt?.toDate?.() ?? new Date();
  const timeStr = `${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;

  const canConfirm =
    order.status === 'unpaid' || order.status === 'pending';

  return (
    <PageShell title={`订单 #${order.orderNumber}`} subtitle={order.projectTitle}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <div className="space-y-4 text-sm text-gray-800">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-emerald-900">
          <div className="text-lg font-bold">#{order.orderNumber}</div>
          <p className="mt-1 text-sm">下单时间：{timeStr}</p>
          <p>
            状态：
            <span className="font-medium">
              {statusLabel[order.status] ?? order.status}
            </span>
          </p>
          <p className="mt-1">
            应付：<strong>{formatMYR(order.totalAmount)}</strong>
            {order.status === 'confirmed' ? (
              <span className="ml-2 text-emerald-800">
                （已确认 {formatMYR(order.paidAmount)}）
              </span>
            ) : null}
          </p>
        </div>

        <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-3">
          <div className="mb-2 text-sm font-semibold text-gray-900">商户操作</div>
          {canConfirm ? (
            <button
              type="button"
              disabled={busy !== null}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:bg-gray-300"
              onClick={() => void handleConfirm()}
            >
              {busy === 'confirm' ? '处理中…' : '确认收款'}
            </button>
          ) : (
            <p className="text-xs text-gray-600">
              {order.status === 'confirmed'
                ? '该订单已确认收款。'
                : '当前状态不支持在此确认收款。'}
            </p>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">配送</h2>
          <p className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            {order.deliveryPointSnapshot?.name ?? '未填写'}
          </p>
          {order.deliveryPointSnapshot?.detail ? (
            <p className="mt-1 text-xs text-gray-600">
              {order.deliveryPointSnapshot.detail}
            </p>
          ) : null}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">商品</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {order.lines.map((l) => (
              <li
                key={`${l.productId}-${l.name}`}
                className="flex justify-between gap-2 px-3 py-2"
              >
                <span>
                  {l.name} ×{l.quantity}
                </span>
                <span className="tabular-nums font-medium">
                  {formatMYR(l.subtotal)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">顾客</h2>
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <p>姓名：{order.customerName}</p>
            <p>电话：{order.customerPhone}</p>
            <p>地址：{order.customerAddress}</p>
            <p>备注：{order.customerNote ?? '（无）'}</p>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            内部备注（仅管理员）
          </h2>
          <ul className="mb-2 space-y-2">
            {Array.isArray(order.internalNotes) && order.internalNotes.length > 0
              ? order.internalNotes.map((n, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-700"
                  >
                    {isNoteEntry(n) ? (
                      <>
                        <p>{n.body}</p>
                        <p className="mt-1 text-gray-400">
                          {n.createdAt?.toDate?.()?.toLocaleString?.() ?? ''}{' '}
                          · {n.userId.slice(0, 8)}…
                        </p>
                      </>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans">
                        {JSON.stringify(n)}
                      </pre>
                    )}
                  </li>
                ))
              : (
                  <li className="text-xs text-gray-500">暂无备注</li>
                )}
          </ul>
          <textarea
            className="mb-2 min-h-[4rem] w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900"
            placeholder="添加内部备注…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <button
            type="button"
            disabled={busy !== null || !noteDraft.trim()}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-900 disabled:bg-gray-100"
            onClick={() => void handleNote()}
          >
            {busy === 'note' ? '保存中…' : '保存备注'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            to={baseOrders}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
          >
            返回订单列表
          </Link>
          <Link
            to={customerUrl}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-dashed border-gray-300 px-4 text-sm font-medium text-gray-700"
          >
            顾客视图
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
