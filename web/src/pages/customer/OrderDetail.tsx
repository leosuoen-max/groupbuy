import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { OTHER_DELIVERY_ID } from '../../data/mockDeliveryPoints';
import { listDeliveryPointsByOwnerId } from '../../lib/deliveryPointService';
import { listActiveFeituanDeliveryPointsForProject } from '../../lib/feituanDeliveryService';
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
import { getShopBySlug } from '../../lib/shopService';
import {
  applyCardPaymentToOrder,
  planCardPayment,
  type CardPaymentPlan,
} from '../../lib/cardService';
import {
  orderHasPaymentScreenshots,
  parseScreenshotEntries,
  type ParsedScreenshotEntry,
} from '../../lib/paymentScreenshotHelpers';
import { buildPaymentGroups } from '../../lib/paymentGroups';
import {
  cardApplicationsForPaymentGroup,
  listOrderCardPaymentApplications,
} from '../../lib/orderCardPaymentApplications';
import {
  deriveDisplayOrderStatus,
  sumGroupAmountByStatus,
} from '../../lib/paymentGroupView';
import type { MockDeliveryPoint } from '../../types/orderDraft';
import type {
  OrderDoc,
  OrderLineDoc,
  ProjectDoc,
} from '../../types/firestore';

const statusLabel: Record<string, string> = {
  unpaid: '待付款',
  pending: '待确认',
  confirmed: '已确认付款',
  partial_paid: '待付款',
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

function linePromoTag(line: OrderLineDoc) {
  if (!line.isDiscount) return null;
  const isEarlyBird =
    typeof line.discountEndsAt === 'string' && line.discountEndsAt.trim().length > 0;
  return (
    <span
      className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        isEarlyBird ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-900'
      }`}
    >
      {isEarlyBird ? '早鸟价' : '特惠价'}
    </span>
  );
}

function aggregateOrderLines(lines: OrderLineDoc[]): OrderLineDoc[] {
  const grouped = new Map<string, OrderLineDoc>();
  for (const line of lines) {
    const key = [
      line.productId,
      line.name,
      Number(line.unitPrice ?? 0).toFixed(2),
      line.isDiscount ? '1' : '0',
      line.discountEndsAt ?? '',
    ].join('|');
    const exist = grouped.get(key);
    if (!exist) {
      grouped.set(key, { ...line });
      continue;
    }
    grouped.set(key, {
      ...exist,
      quantity: Number(exist.quantity ?? 0) + Number(line.quantity ?? 0),
      subtotal: Number(exist.subtotal ?? 0) + Number(line.subtotal ?? 0),
    });
  }
  return Array.from(grouped.values());
}

function CardPaymentBreakdown({
  cardPayment,
  lines,
  title = '本组为卡支付自动确认（无需截图）',
}: {
  cardPayment: NonNullable<OrderDoc['cardPayment']>;
  lines: OrderLineDoc[];
  title?: string;
}) {
  if (!cardPayment) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {cardPayment.passCards.map((c) => (
          <li key={c.customerCardId}>
            · 次卡 #{c.customerCardId.slice(0, 6)} — 抵扣 {c.uses} 次（
            {c.appliedLineProductIds
              .map((pid) => lines.find((l) => l.productId === pid)?.name ?? '行')
              .join('、')}
            ）
          </li>
        ))}
        {cardPayment.wallet ? (
          <li>· 钱包扣减 RM {Number(cardPayment.wallet.deduct ?? 0).toFixed(2)}</li>
        ) : null}
        <li className="pt-1 font-semibold">
          共抵扣 RM {Number(cardPayment.totalDeducted ?? 0).toFixed(2)}
        </li>
      </ul>
    </div>
  );
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
    shopSlug?: string;
    projectId: string;
    orderId: string;
  }>();
  const isFeituanOrder = !shopSlug;
  const base = isFeituanOrder
    ? `/feituan/projects/${encodeURIComponent(projectId)}`
    : `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderRow, setOrderRow] = useState<OrderRow | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectDoc, setProjectDoc] = useState<ProjectDoc | null>(null);

  const [cardPlan, setCardPlan] = useState<CardPaymentPlan | null>(null);
  const [cardPlanLoading, setCardPlanLoading] = useState(false);
  const [cardPaying, setCardPaying] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardSuccess, setCardSuccess] = useState<string | null>(null);
  const customerKey = getOrCreateCustomerKey();
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
  const [shopPaymentMethods, setShopPaymentMethods] = useState<
    { id: string; name: string; qrCodeUrl: string }[]
  >([]);
  const [qrPreview, setQrPreview] = useState<{ name: string; url: string } | null>(null);
  const [deliveryReadonlyDetailOpen, setDeliveryReadonlyDetailOpen] =
    useState(false);
  const orphanPointMigratedRef = useRef(false);

  const applyOrderRow = useCallback(
    (row: OrderRow | null) => {
      if (
        !row ||
        (!isFeituanOrder && row.data.shopSlug !== shopSlug) ||
        (isFeituanOrder && row.data.channel !== 'feituan')
      ) {
        setOrderRow(null);
        return;
      }
      setOrderRow(row);
    },
    [isFeituanOrder, shopSlug]
  );

  const order: OrderDoc | null = orderRow?.data ?? null;
  const hasUnpaidGroupForCardPay = order
    ? buildPaymentGroups(order).some((g) => g.status === 'unpaid')
    : false;

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
      queueMicrotask(() => {
        setProjectOpen(false);
        setProjectDoc(null);
      });
      return;
    }
    let cancelled = false;
    void getProject(orderRow.data.projectId).then((row) => {
      if (cancelled) return;
      if (!row) {
        setProjectOpen(false);
        setProjectDoc(null);
        return;
      }
      setProjectDoc(row.data);
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
        const [projectRow, shopRow] = await Promise.all([
          getProject(projectId),
          getShopBySlug(order.shopSlug),
        ]);
        if (!shopRow) throw new Error('店铺不存在');
        let ui: MockDeliveryPoint[] = [];
        if (order.channel === 'feituan' && projectRow?.data) {
          ui = await listActiveFeituanDeliveryPointsForProject(projectRow.data);
        }
        if (ui.length === 0) {
          const rows = await listDeliveryPointsByOwnerId(shopRow.data.ownerId, {
            fallbackShopId: shopRow.id,
          });
          const allowed = new Set(projectRow?.data.deliveryPointIds ?? []);
          const filtered =
            allowed.size > 0 ? rows.filter((r) => allowed.has(r.id)) : rows;
          ui = filtered.map((p) => ({
            id: p.id,
            name: p.data.shortName ?? p.data.name,
            detailAddress: p.data.detailAddress,
            imageUrl: p.data.imageUrl,
          }));
        }
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
    if (!order?.shopSlug) {
      setShopPaymentMethods([]);
      return;
    }
    let cancelled = false;
    void getShopBySlug(order.shopSlug)
      .then((shopRow) => {
        if (cancelled) return;
        const methods = (shopRow?.data.paymentMethods ?? [])
          .map((x) => ({
            id: x.id,
            name: (x.name ?? '').trim() || '收款码',
            qrCodeUrl: (x.qrCodeUrl ?? '').trim(),
          }))
          .filter((x) => Boolean(x.qrCodeUrl));
        setShopPaymentMethods(methods);
      })
      .catch(() => {
        if (!cancelled) setShopPaymentMethods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [order?.shopSlug]);

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

  /** 卡支付允许在订单存在“待付款支付组”时触发（即使同时有待确认组）。 */
  const canCardPay =
    !!order &&
    !!projectDoc &&
    order.channel !== 'feituan' &&
    order.status !== 'cancelled' &&
    hasUnpaidGroupForCardPay &&
    Number(order.pendingAmount ?? 0) > 0;

  useEffect(() => {
    if (!canCardPay || !order || !projectDoc) {
      setCardPlan(null);
      return;
    }
    let cancelled = false;
    setCardPlanLoading(true);
    void planCardPayment(order, projectDoc, customerKey)
      .then((plan) => {
        if (!cancelled) setCardPlan(plan);
      })
      .catch(() => {
        if (!cancelled) setCardPlan(null);
      })
      .finally(() => {
        if (!cancelled) setCardPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canCardPay, order, projectDoc, customerKey]);

  const handleCardPay = useCallback(async () => {
    if (!order || !projectDoc) return;
    if (order.status === 'cancelled') {
      setCardError('订单已取消，无法继续钱包/次卡支付');
      return;
    }
    if (!cardPlan?.ok) return;
    if (!confirm(`将使用 ${cardPlan.summary.passUseCount > 0 ? `次卡 ${cardPlan.summary.passUseCount} 次` : ''}${cardPlan.summary.passUseCount > 0 && cardPlan.walletDeduct > 0 ? ' + ' : ''}${cardPlan.walletDeduct > 0 ? `钱包 RM ${cardPlan.walletDeduct.toFixed(2)}` : ''} 付清本订单。\n确认抵扣并自动确认订单？`)) {
      return;
    }
    setCardPaying(true);
    setCardError(null);
    setCardSuccess(null);
    try {
      const orderDocId = orderRow?.id;
      if (!orderDocId) throw new Error('订单 ID 缺失');
      await applyCardPaymentToOrder({
        projectId: order.projectId,
        orderId: orderDocId,
        customerKey,
      });
      setCardSuccess('卡支付成功，订单已确认');
      const next = await getOrderByNumber(order.projectId, order.orderNumber);
      if (next) applyOrderRow(next);
    } catch (e) {
      setCardError(e instanceof Error ? e.message : '卡支付失败');
    } finally {
      setCardPaying(false);
    }
  }, [order, projectDoc, cardPlan, orderRow?.id, customerKey, applyOrderRow]);

  const canEditContact =
    !!order &&
    order.channel !== 'feituan' &&
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
  const paymentGroups = buildPaymentGroups(order);
  const displayStatus = deriveDisplayOrderStatus(order, paymentGroups);
  const confirmedAmount = sumGroupAmountByStatus(paymentGroups, 'confirmed');
  const unpaidAmount = sumGroupAmountByStatus(paymentGroups, 'unpaid');
  const useSplitLayout = paymentGroups.length > 0;
  const withUrlShots = shots.filter((s) => s.url);
  const displayGroups = paymentGroups.map((g) => {
    const t = new Date(g.timeMs);
    const timeLabel = `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return {
      key: g.id,
      status: g.status,
      timeLabel,
      lines: g.lines,
      subtotal: g.subtotal,
      proofs: g.proofs,
      hasCardAuto: g.hasCardAuto,
      appendBatchIds: g.appendBatchIds,
      includesInitial: g.includesInitial,
    };
  });
  const cardAppsAll = listOrderCardPaymentApplications(order);
  const cardWalletTotal = cardAppsAll.reduce(
    (s, c) => s + Number(c.wallet?.deduct ?? 0),
    0
  );
  const cardPassUsesTotal = cardAppsAll.reduce(
    (s, c) =>
      s +
      c.passCards.reduce((u, p) => u + (Number(p.uses) || 0), 0),
    0
  );
  const cardDeductGrandTotal = cardAppsAll.reduce(
    (s, c) => s + Number(c.totalDeducted ?? 0),
    0
  );
  const statusText = {
    confirmed: '已确认',
    pending: '待确认',
    unpaid: '待付款',
  } as const;
  // “当前待支付”只统计待付款组；待确认代表已发起支付动作，不应继续计入待支付。
  const currentUnpaidAmount = displayGroups
    .filter((g) => g.status === 'unpaid')
    .reduce((s, g) => s + Number(g.subtotal || 0), 0);

  const uploadHintTop =
    order.status === 'partial_paid'
      ? '请按下方「待付」金额补款并上传截图；同一档加购若尚未上传凭证，再次加菜会合并；上传后再加购会产生新的一档待确认。'
      : order.status === 'pending'
        ? '可继续追加截图。上传同一浏览器。'
        : order.status === 'unpaid' && !hasShots
          ? '请按「应付合计」转账。你可「一笔付清」或「分多笔支付」，只要到账总额与订单金额一致即可；上传至少一张截图供商户核对。没有付款凭证，不配送。'
          : order.status === 'unpaid' && hasShots
            ? '尚未核实前仍可追加或更换截图（先删后传）。分笔付款时总额需与应付一致。'
            : '上传后订单进入「待确认」。请使用本机下单时的同一浏览器。';

  const uploadButtonLabel =
    order.status === 'partial_paid'
      ? '上传补款截图'
      : '选择图片上传';
  const primaryPaymentMethod = shopPaymentMethods[0] ?? null;
  const extraPaymentMethods = shopPaymentMethods.slice(1);

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
              {statusLabel[displayStatus] ?? displayStatus}
            </span>
          </p>
          {(confirmedAmount > 0 || unpaidAmount > 0) && order.status !== 'cancelled' ? (
            <p className="mt-2 text-xs text-emerald-950">
              已付（商户已确认部分）：{formatMYR(confirmedAmount)} · 待付：{' '}
              <strong>{formatMYR(unpaidAmount)}</strong>
            </p>
          ) : null}
          {cardAppsAll.length > 0 ? (
            <div className="mt-2 rounded-lg bg-white/80 px-2 py-1.5 text-[11px] text-emerald-900 ring-1 ring-emerald-200">
              <span className="font-semibold">卡支付：</span>
              {cardPassUsesTotal > 0 ? (
                <span className="ml-1">次卡 {cardPassUsesTotal} 次</span>
              ) : null}
              {cardWalletTotal > 0 ? (
                <span className="ml-1">
                  · 钱包 RM {cardWalletTotal.toFixed(2)}
                </span>
              ) : null}
              <span className="ml-1">
                · 共 RM {cardDeductGrandTotal.toFixed(2)}
                {cardAppsAll.length > 1 ? `（${cardAppsAll.length} 笔）` : ''}
              </span>
            </div>
          ) : null}
          {order.status === 'unpaid' && order.timedPromoPaymentDueAt ? (
            <p className="mt-1 text-xs text-amber-700">
              含限时优惠，请在30分钟内付款（截止{' '}
              {order.timedPromoPaymentDueAt.toDate().toLocaleString('zh-CN', {
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

        {canAddItems ? (
          <div>
            <Link
              to={`${base}?appendOrder=${encodeURIComponent(order.orderNumber)}`}
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
            {displayGroups.map((g, idx) => (
              <div
                key={g.key}
                className={`rounded-xl px-3 py-3 ${
                  g.status === 'confirmed'
                    ? 'border border-gray-200 bg-gray-50/80'
                    : 'border border-indigo-100 bg-indigo-50/40'
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    支付组 {idx + 1}
                  </h3>
                  <span
                    className={`text-xs font-medium ${
                      g.status === 'confirmed'
                        ? 'text-emerald-800'
                        : g.status === 'pending'
                          ? 'text-sky-800'
                          : 'text-amber-900'
                    }`}
                  >
                    {statusText[g.status]}
                  </span>
                </div>
                {g.timeLabel ? (
                  <p className="mb-2 text-xs text-gray-600">{g.timeLabel}</p>
                ) : null}
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                  {aggregateOrderLines(g.lines).map((l, idx2) => (
                    <li
                      key={`${g.key}-${l.productId}-${idx2}`}
                      className="flex justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        {l.name}
                        {linePromoTag(l)} ×{l.quantity}
                      </span>
                      <span className="tabular-nums font-medium">
                        {formatMYR(l.subtotal)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
                  <span>本笔小计</span>
                  <span>{formatMYR(g.subtotal)}</span>
                </div>
              </div>
            ))}
            <div className="flex justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-gray-900">
              <span>订单总额</span>
              <span>{formatMYR(order.totalAmount)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-amber-900">
              <span>当前待支付</span>
              <span>{formatMYR(currentUnpaidAmount)}</span>
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
                    {l.name}
                    {linePromoTag(l)} ×{l.quantity}
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatMYR(l.unitPrice * l.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
              <span>订单总额</span>
              <span>{formatMYR(order.totalAmount)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm font-semibold text-amber-900">
              <span>当前待支付</span>
              <span>{formatMYR(currentUnpaidAmount)}</span>
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
                <div className="relative">
                  <textarea
                    className="mt-1 min-h-[3rem] w-full rounded-lg border border-gray-200 px-3 py-2 pr-14 text-[16px] text-gray-900"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={
                      draftDeliveryId === OTHER_DELIVERY_ID
                        ? '楼栋、门牌、片区等'
                        : '如需送货上门请填写；到点自取可留空（将写入占位地址）。'
                    }
                  />
                  {address.trim() ? (
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm"
                      onClick={() => setAddress('')}
                    >
                      清空
                    </button>
                  ) : null}
                </div>
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

        {canCardPay ? (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
            <h2 className="mb-1 text-sm font-semibold text-indigo-900">
              支付方法一：钱包 / 优惠卡支付
            </h2>
            <p className="mb-2 text-xs leading-relaxed text-indigo-900/80">
              一键自动抵扣：先扣可用次卡，再用钱包补齐。
              全额抵扣完成即自动确认订单（无需上传截图）。
            </p>
            {cardPlanLoading ? (
              <p className="text-xs text-indigo-700">正在评估你的卡余额…</p>
            ) : null}
            {cardPlan ? (
              cardPlan.ok ? (
                <>
                  <div className="mb-2 rounded-lg bg-white px-3 py-2 text-xs text-indigo-900 ring-1 ring-indigo-100">
                    <p>
                      可抵扣：
                      {cardPlan.summary.passUseCount > 0 ? (
                        <span className="ml-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-800">
                          次卡 {cardPlan.summary.passUseCount} 次（≈ RM{' '}
                          {cardPlan.passCovered.toFixed(2)}）
                        </span>
                      ) : null}
                      {cardPlan.walletDeduct > 0 ? (
                        <span className="ml-1 inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800">
                          钱包 RM {cardPlan.walletDeduct.toFixed(2)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1">
                      合计抵扣 RM {cardPlan.totalAmount.toFixed(2)}
                      <span className="ml-1 text-indigo-600">→ 全额付清</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={cardPaying}
                    onClick={() => void handleCardPay()}
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {cardPaying ? '处理中…' : '立即抵扣并确认订单'}
                  </button>
                </>
              ) : (() => {
                  const failedPlan = cardPlan as Extract<
                    CardPaymentPlan,
                    { ok: false }
                  >;
                  return (
                    <div className="space-y-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
                      <p className="font-medium">{failedPlan.message}</p>
                      <p>
                        已可抵扣：次卡覆盖 RM {failedPlan.passCovered.toFixed(2)} ·
                        钱包余额 RM {failedPlan.walletAvailable.toFixed(2)} · 合计差{' '}
                        RM {failedPlan.gap.toFixed(2)}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Link
                          to={`/shop/${encodeURIComponent(order.shopSlug)}/cards?from=${encodeURIComponent(order.projectId)}`}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white"
                        >
                          去充值 / 购买
                        </Link>
                        <span className="text-[11px] text-amber-700">
                          或在下方上传付款凭证
                        </span>
                      </div>
                    </div>
                  );
                })()
            ) : !cardPlanLoading ? (
              <p className="text-xs text-indigo-700">
                <Link
                  to={`/shop/${encodeURIComponent(order.shopSlug)}/cards?from=${encodeURIComponent(order.projectId)}`}
                  className="underline-offset-2 hover:underline"
                >
                  查看 / 购买卡 →
                </Link>
              </p>
            ) : null}
            {cardError ? (
              <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                {cardError}
              </p>
            ) : null}
            {cardSuccess ? (
              <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                {cardSuccess}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
          <h2 className="mb-2 text-sm font-semibold text-indigo-900">
            支付方法二：转账、上传付款截图
          </h2>
          <div className="flex gap-3">
            <div className="w-[6.5rem] shrink-0">
              {primaryPaymentMethod ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setQrPreview({
                        name: primaryPaymentMethod.name,
                        url: primaryPaymentMethod.qrCodeUrl,
                      })
                    }
                    className="overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm"
                  >
                    <img
                      src={primaryPaymentMethod.qrCodeUrl}
                      alt={primaryPaymentMethod.name}
                      className="aspect-square w-[6.5rem] object-cover"
                      loading="lazy"
                    />
                  </button>
                  <p className="mt-1 text-center text-[11px] text-indigo-900/80">
                    {primaryPaymentMethod.name}
                  </p>
                </>
              ) : (
                <div className="flex aspect-square w-[6.5rem] items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-white text-[11px] text-indigo-500">
                  暂无收款码
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="mb-2 text-xs leading-relaxed text-indigo-900/80">
                请按「应付合计」转账。可一笔付清或分多笔支付，到账总额与订单金额一致即可。
              </p>
              {canUpload ? (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={onPickFile}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {uploading ? '上传中…' : uploadButtonLabel}
                </button>
              ) : (
                <div className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-indigo-100 bg-white px-2 text-xs text-gray-500">
                  {order.status === 'cancelled'
                    ? '订单已取消'
                    : order.status === 'confirmed'
                      ? '已全部确认'
                      : '当前不可上传'}
                </div>
              )}
              <p className="mt-1 truncate text-[11px] text-indigo-900/70" title={uploadHintTop}>
                {uploadHintTop}
              </p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              {extraPaymentMethods.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {extraPaymentMethods.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setQrPreview({ name: x.name, url: x.qrCodeUrl })}
                      className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] text-indigo-700"
                    >
                      {x.name}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-indigo-900/70">点击收款码可放大 / 下载</span>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-amber-700">没有付款凭证，不配送。</span>
          </div>
        </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
          />

          {uploadError ? (
            <p className="mb-2 text-xs text-red-600">{uploadError}</p>
          ) : null}

          {withUrlShots.length > 0 ? (
            useSplitLayout ? (
              <div className="space-y-4">
                {displayGroups.map((g, idx) => {
                  const groupShots = g.proofs.filter((x) => Boolean(x.url));
                  const appsForGroup = cardApplicationsForPaymentGroup(order, {
                    includesInitial: g.includesInitial,
                    appendBatchIds: g.appendBatchIds,
                    hasCardAuto: g.hasCardAuto,
                  });
                  const isCardGroup =
                    g.hasCardAuto ||
                    (g.status === 'confirmed' &&
                      appsForGroup.length > 0 &&
                      groupShots.length === 0);
                  return (
                    <div key={`shots-${g.key}`}>
                      <p
                        className={`mb-2 text-xs font-semibold ${
                          g.status === 'confirmed' ? 'text-gray-700' : 'text-indigo-900'
                        }`}
                      >
                        支付组 {idx + 1}{g.timeLabel ? ` · ${g.timeLabel}` : ''}
                      </p>
                      {isCardGroup && groupShots.length === 0 ? (
                        <div className="space-y-2">
                          {appsForGroup.map((cp, ai) => (
                            <CardPaymentBreakdown
                              key={`${cp.appliedAt?.toMillis?.() ?? 0}-${ai}`}
                              cardPayment={cp}
                              lines={g.lines}
                              title={
                                appsForGroup.length > 1
                                  ? `本组卡支付自动确认（第 ${ai + 1} 笔）`
                                  : undefined
                              }
                            />
                          ))}
                        </div>
                      ) : groupShots.length > 0 ? (
                        <ul className="space-y-2">{groupShots.map(renderPaymentShot)}</ul>
                      ) : (
                        <p className="text-xs text-gray-500">暂无截图</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="space-y-2">
                {withUrlShots.map((s, i) => renderPaymentShot(s, i))}
              </ul>
            )
          ) : cardAppsAll.length > 0 &&
            (order.initialPaymentConfirmedAt ||
              (order.appendBatches ?? []).some((b) => b.confirmedAt)) ? (
            <div>
              <p className="mb-2 text-xs text-gray-500">卡扣款明细（无截图）</p>
              <div className="space-y-2">
                {cardAppsAll.map((cp, ai) => (
                  <CardPaymentBreakdown
                    key={`${cp.appliedAt?.toMillis?.() ?? 0}-${ai}`}
                    cardPayment={cp}
                    lines={order.lines}
                    title={
                      cardAppsAll.length > 1
                        ? `卡支付自动确认（第 ${ai + 1} 笔）`
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

        <div className="mt-2 border-t border-gray-100 pt-6">
          <div className="flex gap-3">
            <Link
              to={base}
              className="group inline-flex min-h-[3.25rem] flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-5 w-5 shrink-0 text-gray-500 transition group-hover:text-gray-700"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                />
              </svg>
              <span>返回首页</span>
            </Link>
            <Link
              to={`${base}/my-orders`}
              className="group inline-flex min-h-[3.25rem] flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-indigo-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/25 transition hover:from-indigo-500 hover:to-indigo-600 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-5 w-5 shrink-0 text-indigo-100"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                />
              </svg>
              <span>我的订单</span>
            </Link>
          </div>
        </div>
      </div>
      {qrPreview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4"
          onClick={() => setQrPreview(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-center text-sm font-semibold text-gray-900">
              {qrPreview.name}
            </p>
            <img
              src={qrPreview.url}
              alt={qrPreview.name}
              className="aspect-square w-full rounded-xl border border-gray-100 object-contain"
            />
            <div className="mt-3 flex gap-2">
              <a
                href={qrPreview.url}
                download={`${qrPreview.name || '收款码'}.png`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white"
              >
                下载收款码
              </a>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm text-gray-700"
                onClick={() => setQrPreview(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
