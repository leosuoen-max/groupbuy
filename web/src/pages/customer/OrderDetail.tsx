import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { OTHER_DELIVERY_ID } from '../../data/mockDeliveryPoints';
import { listDeliveryPointsByShopId } from '../../lib/deliveryPointService';
import {
  addressFieldPrefillForContactEdit,
  resolveCustomerAddressForChoice,
  showExtraAddressUnderDeliveryPoint,
} from '../../lib/orderDeliveryHelpers';
import {
  customerDeletePaymentScreenshot,
  customerUpdateOrderContact,
  customerUploadPaymentScreenshot,
  getOrderByNumber,
  type OrderRow,
} from '../../lib/orderService';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { getProject } from '../../lib/projectService';
import {
  hasPaymentScreenshotForAppendBatch,
  orderHasPaymentScreenshots,
  parseScreenshotEntries,
  type ParsedScreenshotEntry,
} from '../../lib/paymentScreenshotHelpers';
import type { MockDeliveryPoint } from '../../types/orderDraft';
import type { OrderAppendBatchDoc, OrderDoc, ProjectDoc } from '../../types/firestore';

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

function projectAllowsCustomerEdit(p: ProjectDoc | null): boolean {
  if (!p) return false;
  if (p.status === 'draft' || p.status === 'closed') return false;
  const c = p.closesAt?.toDate?.();
  if (c && c.getTime() <= Date.now()) return false;
  return true;
}

function batchTimeStr(b: OrderAppendBatchDoc): string {
  const d = b.appendedAt?.toDate?.();
  if (!d) return '';
  return d.toLocaleString();
}

function canCustomerDeleteScreenshot(
  order: OrderDoc,
  shot: ParsedScreenshotEntry
): boolean {
  if (!shot.url) return false;
  if (order.status === 'confirmed' || order.status === 'cancelled') return false;
  const appendBatches = order.appendBatches ?? [];
  const pendingBatches = appendBatches.filter((b) => !b.confirmedAt);

  if (shot.appendBatchId) {
    const batch = appendBatches.find((b) => b.id === shot.appendBatchId);
    return !batch?.confirmedAt;
  }

  const uploadedMs = shot.uploadedAt?.toMillis?.();
  const minPendingMs =
    pendingBatches.length > 0
      ? Math.min(...pendingBatches.map((b) => b.appendedAt.toMillis()))
      : Number.POSITIVE_INFINITY;
  const likelyPendingAppendProof =
    typeof uploadedMs === 'number' &&
    pendingBatches.length > 0 &&
    uploadedMs >= minPendingMs;
  if (likelyPendingAppendProof) return true;

  return !order.initialPaymentConfirmedAt;
}

function buildDeliveryUpdateFromDraft(
  draftDeliveryId: string,
  points: MockDeliveryPoint[],
  addrOut: string
): NonNullable<
  Parameters<typeof customerUpdateOrderContact>[0]['delivery']
> {
  if (draftDeliveryId === OTHER_DELIVERY_ID) {
    return {
      isManualMatch: true,
      deliveryPointSnapshot: {
        name: `其他（将按地址手动匹配）：${addrOut}`,
      },
    };
  }
  const p = points.find((x) => x.id === draftDeliveryId);
  if (!p) throw new Error('请选择有效配送点');
  const detailParts = [p.detailAddress, p.deliveryTime].filter(Boolean);
  return {
    isManualMatch: false,
    deliveryPointId: draftDeliveryId,
    deliveryPointSnapshot: {
      name: p.name,
      detail: detailParts.length ? detailParts.join(' · ') : undefined,
    },
  };
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
  const [projectOpen, setProjectOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [editingContact, setEditingContact] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);

  const [draftDeliveryId, setDraftDeliveryId] = useState<string>(OTHER_DELIVERY_ID);
  const [deliveryPoints, setDeliveryPoints] = useState<MockDeliveryPoint[]>([]);
  const [deliveryPointsLoading, setDeliveryPointsLoading] = useState(false);
  const [deliveryPointsErr, setDeliveryPointsErr] = useState<string | null>(null);
  const [deliveryReadonlyDetailOpen, setDeliveryReadonlyDetailOpen] =
    useState(false);
  const orphanPointMigratedRef = useRef(false);

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

  const order: OrderDoc | null = orderRow?.data ?? null;

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

  useEffect(() => {
    if (!orderRow?.data.projectId) {
      queueMicrotask(() => setProjectOpen(false));
      return;
    }
    let cancelled = false;
    void getProject(orderRow.data.projectId).then((row) => {
      if (cancelled) return;
      if (!row) {
        setProjectOpen(false);
        return;
      }
      setProjectOpen(projectAllowsCustomerEdit(row.data));
    });
    return () => {
      cancelled = true;
    };
  }, [orderRow?.data.projectId, orderRow?.id]);

  useEffect(() => {
    if (!editingContact || !order) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setDeliveryPointsLoading(true);
      setDeliveryPointsErr(null);
      try {
        const projectRow = await getProject(projectId);
        const rows = await listDeliveryPointsByShopId(order.shopId);
        const allowed = new Set(projectRow?.data.deliveryPointIds ?? []);
        const filtered =
          allowed.size > 0 ? rows.filter((r) => allowed.has(r.id)) : rows;
        const ui: MockDeliveryPoint[] = filtered.map((p) => ({
          id: p.id,
          name: p.data.name,
          detailAddress: p.data.detailAddress,
          deliveryTime: p.data.deliveryTime,
          imageUrl: p.data.imageUrl,
        }));
        if (!cancelled) setDeliveryPoints(ui);
      } catch {
        if (!cancelled) {
          setDeliveryPointsErr('配送点加载失败');
          setDeliveryPoints([]);
        }
      } finally {
        if (!cancelled) setDeliveryPointsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingContact, order, projectId]);

  useEffect(() => {
    if (!editingContact) orphanPointMigratedRef.current = false;
  }, [editingContact]);

  /** 原配送点已从项目中移除时，退回「其他」并带出完整地址（仅自动处理一次，避免覆盖用户正在编辑的内容） */
  useEffect(() => {
    if (!editingContact || !order) return;
    if (!order.deliveryPointId || order.isManualMatch) return;
    if (deliveryPoints.length === 0) return;
    const stillThere = deliveryPoints.some(
      (p) => p.id === order.deliveryPointId
    );
    if (stillThere) return;
    if (orphanPointMigratedRef.current) return;
    orphanPointMigratedRef.current = true;
    const addrFallback = order.customerAddress?.trim() ?? '';
    queueMicrotask(() => {
      setDraftDeliveryId(OTHER_DELIVERY_ID);
      setAddress(addrFallback);
    });
  }, [editingContact, order, deliveryPoints]);

  const canUpload =
    order && uploadAllowedStatuses.has(order.status);

  const canEditContact =
    !!order &&
    projectOpen &&
    order.status !== 'cancelled' &&
    ['unpaid', 'pending', 'confirmed', 'partial_paid'].includes(order.status);

  const canAddItems =
    !!order &&
    projectOpen &&
    order.status !== 'cancelled' &&
    ['unpaid', 'pending', 'confirmed', 'partial_paid'].includes(order.status);

  const saveContact = () => {
    if (!orderRow || !order || !canEditContact) return;
    if (deliveryPointsLoading || deliveryPointsErr) {
      setContactMsg('配送点尚未加载完成，请稍后再试。');
      return;
    }
    const addrOut = resolveCustomerAddressForChoice(
      draftDeliveryId,
      address,
      deliveryPoints
    );
    if (!addrOut.trim()) {
      setContactMsg('请填写详细地址；若已选配送点可留空门牌以使用系统占位地址。');
      return;
    }
    let delivery: NonNullable<
      Parameters<typeof customerUpdateOrderContact>[0]['delivery']
    >;
    try {
      delivery = buildDeliveryUpdateFromDraft(
        draftDeliveryId,
        deliveryPoints,
        addrOut
      );
    } catch (e: unknown) {
      setContactMsg(e instanceof Error ? e.message : '配送信息无效');
      return;
    }
    setContactSaving(true);
    setContactMsg(null);
    void customerUpdateOrderContact({
      orderFirestoreId: orderRow.id,
      projectId,
      orderNumber: order.orderNumber,
      customerKey: getOrCreateCustomerKey(),
      customerName: name,
      customerPhone: phone,
      customerAddress: addrOut,
      customerNote: note,
      delivery,
    })
      .then(() =>
        getOrderByNumber(projectId, decodeURIComponent(orderId)).then(
          applyOrderRow
        )
      )
      .then(() => {
        setEditingContact(false);
        setContactMsg('已保存');
      })
      .catch((err: unknown) => {
        setContactMsg(
          err instanceof Error ? err.message : '保存失败'
        );
      })
      .finally(() => {
        setContactSaving(false);
      });
  };

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
  const hasShots = orderHasPaymentScreenshots(order.paymentScreenshots);
  const paid = Number(order.paidAmount) || 0;
  const pending = Number(order.pendingAmount) || 0;
  const appendBatches = order.appendBatches ?? [];
  const useSplitLayout =
    appendBatches.length > 0 && (order.initialLines?.length ?? 0) > 0;
  const initialLines = order.initialLines?.length
    ? order.initialLines
    : order.lines;
  const initialTotal =
    order.initialTotalAmount ??
    (order.initialLines?.length
      ? order.initialLines.reduce((s, l) => s + l.subtotal, 0)
      : order.totalAmount);
  const withUrlShots = shots.filter((s) => s.url);
  const confirmedAppendBatches = appendBatches.filter((b) => b.confirmedAt);
  const pendingAppendBatches = appendBatches.filter((b) => !b.confirmedAt);
  const pendingAppendIds = pendingAppendBatches.map((b) => b.id);
  const includeUntaggedForAppendShots =
    pendingAppendIds.length > 1 ||
    (pendingAppendIds.length === 1 &&
      !hasPaymentScreenshotForAppendBatch(
        order.paymentScreenshots,
        pendingAppendIds[0]!
      ));
  const minPendingAppendMs =
    pendingAppendBatches.length > 0
      ? Math.min(...pendingAppendBatches.map((b) => b.appendedAt.toMillis()))
      : 0;
  const lumpAppendShots = withUrlShots.filter((s) => {
    if (!pendingAppendIds.length) return false;
    const bid = s.appendBatchId;
    if (bid && pendingAppendIds.includes(bid)) return true;
    if (
      order.status === 'partial_paid' &&
      includeUntaggedForAppendShots &&
      (bid == null || bid === '')
    ) {
      const ua = s.uploadedAt?.toMillis?.() ?? 0;
      if (ua < minPendingAppendMs) return false;
      return true;
    }
    return false;
  });
  const firstShots = withUrlShots.filter((s) => {
    const untagged = s.appendBatchId == null || s.appendBatchId === '';
    if (!untagged) return false;
    if (
      order.status === 'partial_paid' &&
      pendingAppendIds.length &&
      includeUntaggedForAppendShots
    ) {
      return false;
    }
    return true;
  });

  const uploadHintTop =
    order.status === 'partial_paid'
      ? '请按下方「待付」金额补款并上传截图；同一档加购若尚未上传凭证，再次加菜会合并；上传后再加购会产生新的一档待确认。'
      : order.status === 'pending'
        ? '可继续追加截图。上传同一浏览器。'
        : order.status === 'unpaid' && !hasShots
          ? '请按「应付合计」转账。你可「一笔付清」或「分多笔支付」，只要到账总额与订单金额一致即可；上传至少一张截图供商户核对。'
          : order.status === 'unpaid' && hasShots
            ? '尚未核实前仍可追加或更换截图（先删后传）。分笔付款时总额需与应付一致。'
            : '上传后订单进入「待核实」。请使用本机下单时的同一浏览器。';

  const uploadButtonLabel =
    order.status === 'partial_paid'
      ? '上传补款截图'
      : '选择图片上传';

  const renderPaymentShot = (s: ParsedScreenshotEntry, i: number) => (
    <li
      key={`${s.id ?? s.url}-${i}`}
      className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2"
    >
      <a href={s.url!} target="_blank" rel="noreferrer" className="shrink-0">
        <img
          src={s.url!}
          alt=""
          className="h-16 w-16 rounded-md object-cover"
        />
      </a>
      <div className="min-w-0 flex-1 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{flagLabel(s.flag)}</p>
            {s.flagReason ? (
              <p className="mt-0.5 text-gray-600">{s.flagReason}</p>
            ) : null}
            {s.uploadedAt ? (
              <p className="mt-1 text-gray-500">
                {s.uploadedAt.toDate().toLocaleString()}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={s.url!}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-indigo-600 underline-offset-2 hover:underline"
              >
                查看原图
              </a>
              {canUpload && canCustomerDeleteScreenshot(order, s) ? (
                <button
                  type="button"
                  disabled={deletingKey === (s.id ?? s.url) || uploading}
                  onClick={() => onDeleteShot(s)}
                  className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {deletingKey === (s.id ?? s.url) ? '删除中…' : '删除'}
                </button>
              ) : canUpload ? (
                <span className="text-gray-400">已确认不可删除</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </li>
  );

  return (
    <PageShell title={`订单 #${order.orderNumber}`} subtitle={order.projectTitle}>
      <div className="space-y-4 text-sm text-gray-800">
        {!projectOpen ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            项目已截单或已关闭：不可修改信息或加菜；付款截图规则以当前状态为准。
          </p>
        ) : null}

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
          {(paid > 0 || pending > 0) && order.status !== 'cancelled' ? (
            <p className="mt-2 text-xs text-emerald-950">
              已付（商户已确认部分）：{formatMYR(paid)} · 待付：{' '}
              <strong>{formatMYR(pending)}</strong>
            </p>
          ) : null}
        </div>

        {canAddItems ? (
          <div>
            <Link
              to={`${base}/orders/${encodeURIComponent(order.orderNumber)}/add-items`}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-emerald-400 bg-emerald-50/80 text-sm font-semibold text-emerald-900"
            >
              ＋ 加菜 / 补购商品
            </Link>
            <p className="mt-1 text-xs text-gray-500">
              加菜后应付会增加；若原单已确认收款，需补付差额并上传截图。
            </p>
          </div>
        ) : null}

        {useSplitLayout ? (
          <div className="space-y-4">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">首单</h2>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                {initialLines.map((l, idx) => (
                  <li
                    key={`init-${l.productId}-${idx}`}
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
              <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
                <span>首单小计</span>
                <span>{formatMYR(initialTotal)}</span>
              </div>
            </div>
            {confirmedAppendBatches.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-3"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    加购（补款已确认）
                  </h3>
                  <span className="text-xs font-medium text-emerald-800">
                    已入账
                  </span>
                </div>
                <p className="mb-2 text-xs text-gray-600">{batchTimeStr(b)}</p>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                  {b.lines.map((l, idx) => (
                    <li
                      key={`${b.id}-${l.productId}-${idx}`}
                      className="flex justify-between gap-2 px-3 py-2 text-sm"
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
                <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
                  <span>本笔小计</span>
                  <span>{formatMYR(b.deltaAmount)}</span>
                </div>
              </div>
            ))}
            {pendingAppendBatches.length > 0 ? (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-indigo-950">加购</h3>
                  <span className="text-xs font-medium text-amber-900">
                    待商户确认 · 待付{' '}
                    {formatMYR(
                      pendingAppendBatches.reduce(
                        (s, b) => s + (Number(b.deltaAmount) || 0),
                        0
                      )
                    )}
                  </span>
                </div>
                <p className="mb-2 text-xs text-gray-600">
                  {(() => {
                    const sorted = [...pendingAppendBatches].sort(
                      (a, b) =>
                        (a.appendedAt?.toMillis?.() ?? 0) -
                        (b.appendedAt?.toMillis?.() ?? 0)
                    );
                    const t0 = sorted[0]?.appendedAt;
                    const t1 = sorted[sorted.length - 1]?.appendedAt;
                    return sorted.length > 1 &&
                      t0 &&
                      t1 &&
                      t0.toMillis() !== t1.toMillis()
                      ? `${t0.toDate().toLocaleString()} — ${t1.toDate().toLocaleString()}`
                      : batchTimeStr(sorted[0]!);
                  })()}
                </p>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                  {[...pendingAppendBatches]
                    .sort(
                      (a, b) =>
                        (a.appendedAt?.toMillis?.() ?? 0) -
                        (b.appendedAt?.toMillis?.() ?? 0)
                    )
                    .flatMap((b) => b.lines)
                    .map((l, idx) => (
                      <li
                        key={`pend-${l.productId}-${idx}`}
                        className="flex justify-between gap-2 px-3 py-2 text-sm"
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
                <div className="mt-2 flex justify-between text-sm font-semibold text-indigo-950">
                  <span>加购小计</span>
                  <span>
                    {formatMYR(
                      pendingAppendBatches.reduce(
                        (s, b) => s + (Number(b.deltaAmount) || 0),
                        0
                      )
                    )}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-gray-900">
              <span>应付合计</span>
              <span>{formatMYR(order.totalAmount)}</span>
            </div>
          </div>
        ) : (
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
              <span>应付合计</span>
              <span>{formatMYR(order.totalAmount)}</span>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">顾客信息</h2>
            {canEditContact ? (
              <button
                type="button"
                onClick={() => {
                  setContactMsg(null);
                  if (!editingContact && order) {
                    orphanPointMigratedRef.current = false;
                    setName(order.customerName);
                    setPhone(order.customerPhone);
                    setAddress(addressFieldPrefillForContactEdit(order));
                    setNote(order.customerNote ?? '');
                    setDraftDeliveryId(
                      order.deliveryPointId && !order.isManualMatch
                        ? order.deliveryPointId
                        : OTHER_DELIVERY_ID
                    );
                    setDeliveryReadonlyDetailOpen(false);
                  }
                  setEditingContact((e) => !e);
                }}
                className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
              >
                {editingContact ? '取消' : '修改'}
              </button>
            ) : null}
          </div>
          {editingContact && canEditContact ? (
            <div className="space-y-2 rounded-xl border border-gray-200 bg-white px-3 py-3">
              <label className="block text-xs text-gray-600">
                姓名
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block text-xs text-gray-600">
                电话
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <div className="border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-medium text-gray-800">
                  配送方式
                </p>
                {deliveryPointsLoading ? (
                  <p className="text-xs text-gray-500">正在加载配送点…</p>
                ) : null}
                {deliveryPointsErr ? (
                  <p className="text-xs text-red-600">{deliveryPointsErr}</p>
                ) : null}
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {deliveryPoints.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-100 px-2 py-2 text-xs text-gray-900"
                    >
                      <input
                        type="radio"
                        name="order-delivery"
                        className="mt-0.5"
                        checked={draftDeliveryId === p.id}
                        onChange={() => setDraftDeliveryId(p.id)}
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/50 px-2 py-2 text-xs text-gray-900">
                    <input
                      type="radio"
                      name="order-delivery"
                      className="mt-0.5"
                      checked={draftDeliveryId === OTHER_DELIVERY_ID}
                      onChange={() => setDraftDeliveryId(OTHER_DELIVERY_ID)}
                    />
                    <span>
                      以上都不对（其他）
                      <span className="mt-0.5 block text-[11px] text-amber-900">
                        填写完整地址，由商户按地址配送。
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <label className="block text-xs text-gray-600">
                {draftDeliveryId === OTHER_DELIVERY_ID ? (
                  <>
                    详细地址 <span className="text-red-600">*</span>
                  </>
                ) : (
                  <>补充地址 / 门牌（选填）</>
                )}
                <textarea
                  className="mt-1 min-h-[3rem] w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={
                    draftDeliveryId === OTHER_DELIVERY_ID
                      ? '楼栋、门牌、片区等'
                      : '如需送货上门请填写；到点自取可留空（将写入占位地址）。'
                  }
                />
              </label>
              <label className="block text-xs text-gray-600">
                备注
                <textarea
                  className="mt-1 min-h-[2.5rem] w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {contactMsg ? (
                <p
                  className={
                    contactMsg === '已保存'
                      ? 'text-xs text-emerald-700'
                      : 'text-xs text-red-600'
                  }
                >
                  {contactMsg}
                </p>
              ) : null}
              <button
                type="button"
                disabled={
                  contactSaving ||
                  deliveryPointsLoading ||
                  Boolean(deliveryPointsErr)
                }
                onClick={() => void saveContact()}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white disabled:bg-gray-400"
              >
                {contactSaving ? '保存中…' : '保存修改'}
              </button>
              <p className="text-[11px] text-gray-500">
                已确认订单修改联系信息后，配送仍以商户核对为准。
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-gray-800">
              <p>姓名：{order.customerName}</p>
              <p>电话：{order.customerPhone}</p>
              {order.deliveryPointId && !order.isManualMatch ? (
                <div className="mt-2 border-t border-gray-200 pt-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-500">
                        配送点
                      </p>
                      <p className="font-semibold text-gray-900">
                        {order.deliveryPointSnapshot?.name ?? '—'}
                      </p>
                    </div>
                    {order.deliveryPointSnapshot?.detail ? (
                      <button
                        type="button"
                        className="shrink-0 text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                        onClick={() =>
                          setDeliveryReadonlyDetailOpen((v) => !v)
                        }
                      >
                        {deliveryReadonlyDetailOpen ? '收起' : '详情'}
                      </button>
                    ) : null}
                  </div>
                  {deliveryReadonlyDetailOpen &&
                  order.deliveryPointSnapshot?.detail ? (
                    <p className="mt-2 rounded-lg bg-white/80 px-2 py-2 text-xs leading-relaxed text-gray-700">
                      {order.deliveryPointSnapshot.detail}
                    </p>
                  ) : null}
                  {showExtraAddressUnderDeliveryPoint(order) ? (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-gray-500">地址</p>
                      <p className="mt-0.5 text-sm break-words text-gray-900">
                        {order.customerAddress}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2">
                  <span className="text-gray-500">地址</span>
                  <span className="mt-0.5 block text-gray-900">
                    {order.customerAddress}
                  </span>
                </p>
              )}
              <p className="mt-2 border-t border-gray-200 pt-2">
                备注：{order.customerNote ?? '（无）'}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            付款截图
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-gray-600">
            {uploadHintTop}
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
              {uploading ? '上传中…' : uploadButtonLabel}
            </button>
          ) : (
            <p className="mb-3 text-xs text-amber-800">
              {order.status === 'cancelled'
                ? '订单已取消，无法上传。'
                : order.status === 'confirmed'
                  ? '订单已全部确认收款，无需再上传。若刚加菜变为待补款，请刷新页面。'
                  : '当前状态不可上传。'}
            </p>
          )}

          {uploadError ? (
            <p className="mb-2 text-xs text-red-600">{uploadError}</p>
          ) : null}

          {withUrlShots.length > 0 ? (
            useSplitLayout ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-800">
                    首单 / 未归类截图
                  </p>
                  {firstShots.length > 0 ? (
                    <ul className="space-y-2">{firstShots.map(renderPaymentShot)}</ul>
                  ) : (
                    <p className="text-xs text-gray-500">暂无（补款截图可能在下方对应加购）</p>
                  )}
                </div>
                {pendingAppendIds.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-indigo-900">
                      加购补款截图（整笔待付{' '}
                      {formatMYR(
                        pendingAppendBatches.reduce(
                          (s, b) => s + (Number(b.deltaAmount) || 0),
                          0
                        )
                      )}
                      ）
                    </p>
                    {lumpAppendShots.length > 0 ? (
                      <ul className="space-y-2">
                        {lumpAppendShots.map((s, i) =>
                          renderPaymentShot(s, i)
                        )}
                      </ul>
                    ) : (
                      <p className="text-xs text-gray-500">
                        尚未上传补款截图
                      </p>
                    )}
                  </div>
                ) : null}
                {confirmedAppendBatches.map((b) => {
                  const bs = withUrlShots.filter((x) => x.appendBatchId === b.id);
                  if (bs.length === 0) return null;
                  return (
                    <div key={`shots-${b.id}`}>
                      <p className="mb-2 text-xs font-semibold text-gray-700">
                        历史加购截图 · {batchTimeStr(b)}
                      </p>
                      <ul className="space-y-2">{bs.map(renderPaymentShot)}</ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="space-y-2">
                {withUrlShots.map((s, i) => renderPaymentShot(s, i))}
              </ul>
            )
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
