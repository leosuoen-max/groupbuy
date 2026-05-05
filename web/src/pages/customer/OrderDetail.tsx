import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import {
  customerDeletePaymentScreenshot,
  customerUploadPaymentScreenshot,
  getOrderByNumber,
  type OrderRow,
} from '../../lib/orderService';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { parseScreenshotEntries } from '../../lib/paymentScreenshotHelpers';
import type { OrderDoc } from '../../types/firestore';

const statusLabel: Record<string, string> = {
  unpaid: '待付款',
  pending: '待核实',
  confirmed: '已确认付款',
  partial_paid: '待补付款',
  cancelled: '已取消',
};

const uploadAllowedStatuses = new Set(['unpaid', 'pending', 'partial_paid']);

function flagLabel(flag: 'green' | 'yellow' | 'red' | null): string {
  if (flag === 'red') return '需核对（重复风险）';
  if (flag === 'yellow') return '需核对（时间异常）';
  if (flag === 'green') return '已上传';
  return '';
}

export default function OrderDetail() {
  const { shopSlug = '', projectId = '', orderId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
    orderId: string;
  }>();
  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderRow, setOrderRow] = useState<OrderRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const applyOrderRow = useCallback(
    (row: OrderRow | null) => {
      if (!row || row.data.shopSlug !== shopSlug) {
        setOrderRow(null);
        return;
      }
      setOrderRow(row);
    },
    [shopSlug]
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
      void getOrderByNumber(projectId, decodeURIComponent(orderId))
        .then((row) => {
          if (cancelled) return;
          applyOrderRow(row);
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
  }, [orderId, projectId, shopSlug, applyOrderRow]);

  const order: OrderDoc | null = orderRow?.data ?? null;
  const canUpload =
    order && uploadAllowedStatuses.has(order.status);

  const onPickFile = () => {
    setUploadError(null);
    fileRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !orderRow || !order) return;

    setUploading(true);
    setUploadError(null);
    const customerKey = getOrCreateCustomerKey();
    void customerUploadPaymentScreenshot({
      orderFirestoreId: orderRow.id,
      projectId,
      orderNumber: order.orderNumber,
      customerKey,
      file,
    })
      .then(() =>
        getOrderByNumber(projectId, decodeURIComponent(orderId)).then(
          applyOrderRow
        )
      )
      .catch((err: unknown) => {
        setUploadError(
          err instanceof Error ? err.message : '上传失败，请重试。'
        );
      })
      .finally(() => {
        setUploading(false);
      });
  };

  const onDeleteShot = (shot: {
    id: string | null;
    url: string | null;
  }) => {
    if (!shot.url || !orderRow || !order) return;
    if (
      !window.confirm('确定删除这张付款截图？删除后可重新上传。')
    ) {
      return;
    }
    const key = shot.id ?? shot.url;
    setDeletingKey(key);
    setUploadError(null);
    void customerDeletePaymentScreenshot({
      orderFirestoreId: orderRow.id,
      projectId,
      orderNumber: order.orderNumber,
      customerKey: getOrCreateCustomerKey(),
      ...(shot.id
        ? { screenshotId: shot.id }
        : { screenshotUrl: shot.url }),
    })
      .then(() =>
        getOrderByNumber(projectId, decodeURIComponent(orderId)).then(
          applyOrderRow
        )
      )
      .catch((err: unknown) => {
        setUploadError(
          err instanceof Error ? err.message : '删除失败，请重试。'
        );
      })
      .finally(() => {
        setDeletingKey(null);
      });
  };

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

  if (!order || !orderRow) {
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

  const shots = parseScreenshotEntries(order.paymentScreenshots);

  return (
    <PageShell title={`订单 #${order.orderNumber}`} subtitle={order.projectTitle}>
      <div className="space-y-4 text-sm text-gray-800">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-emerald-900">
          <div className="text-lg font-bold">#{order.orderNumber}</div>
          <p className="mt-1 text-sm">下单时间：{timeStr}</p>
          <p>配送点：{order.deliveryPointSnapshot?.name ?? '未填写'}</p>
          {order.deliveryPointSnapshot?.detail ? (
            <p className="text-xs text-gray-600">{order.deliveryPointSnapshot.detail}</p>
          ) : null}
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
            {order.lines.map((l, idx) => (
              <li
                key={`${l.productId}-${idx}`}
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

        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            付款截图
          </h2>
          <p className="mb-3 text-xs text-gray-600">
            上传后订单将进入「待核实」，商户核对无误后会确认收款。请使用本机下单时的同一浏览器上传。
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
          />

          {canUpload ? (
            <button
              type="button"
              disabled={uploading}
              onClick={onPickFile}
              className="mb-3 inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {uploading ? '上传中…' : '选择图片上传'}
            </button>
          ) : (
            <p className="mb-3 text-xs text-amber-800">
              {order.status === 'cancelled'
                ? '订单已取消，无法上传。'
                : order.status === 'confirmed'
                  ? '订单已确认付款，无需再上传。'
                  : '当前状态不可上传。'}
            </p>
          )}

          {uploadError ? (
            <p className="mb-2 text-xs text-red-600">{uploadError}</p>
          ) : null}

          {shots.length > 0 ? (
            <ul className="space-y-2">
              {shots.map((s, i) =>
                s.url ? (
                  <li
                    key={`${s.id ?? s.url}-${i}`}
                    className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2"
                  >
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0"
                    >
                      <img
                        src={s.url}
                        alt=""
                        className="h-16 w-16 rounded-md object-cover"
                      />
                    </a>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">
                            {flagLabel(s.flag)}
                          </p>
                          {s.flagReason ? (
                            <p className="mt-0.5 text-gray-600">
                              {s.flagReason}
                            </p>
                          ) : null}
                          {s.uploadedAt ? (
                            <p className="mt-1 text-gray-500">
                              {s.uploadedAt.toDate().toLocaleString()}
                            </p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-block text-indigo-600 underline-offset-2 hover:underline"
                            >
                              查看原图
                            </a>
                            {canUpload ? (
                              <button
                                type="button"
                                disabled={
                                  deletingKey === (s.id ?? s.url) || uploading
                                }
                                onClick={() => onDeleteShot(s)}
                                className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                              >
                                {deletingKey === (s.id ?? s.url)
                                  ? '删除中…'
                                  : '删除'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ) : null
              )}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">尚未上传付款截图。</p>
          )}
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
