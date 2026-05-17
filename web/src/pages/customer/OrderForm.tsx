import { useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { OTHER_DELIVERY_ID } from '../../data/mockDeliveryPoints';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { listDeliveryPointsByOwnerId } from '../../lib/deliveryPointService';
import { listActiveFeituanDeliveryPointsForProject } from '../../lib/feituanDeliveryService';
import {
  createOrder,
  CreateOrderError,
  listFeituanOrdersForCustomer,
  listOrdersByCustomer,
} from '../../lib/orderService';
import { resolveProjectDeliveryLabel } from '../../lib/deliverySlot';
import {
  formatEstimatedDeliveryHint,
  isProjectRecurring,
} from '../../lib/recurringDeliverySchedule';
import { suggestDeliveryPointsFromAddress } from '../../lib/deliveryPointMatch';
import { getProject } from '../../lib/projectService';
import { getShopById, getShopBySlug, isShopOpenForCustomers } from '../../lib/shopService';
import { withTimeout } from '../../lib/withTimeout';
import {
  getWechatNotifyOAuthStateId,
  sendOrderSubmittedWechatNotification,
} from '../../lib/wechatService';
import { FEITUAN_HOME, FEITUAN_TW, feituanOrShopGreen } from '../../lib/feituanHomeTheme';
import type { CartLocationState, MockDeliveryPoint, OrderLine } from '../../types/orderDraft';
import type { OrderDoc, ProjectDoc } from '../../types/firestore';

type Step = 1 | 2 | 3;
const LOAD_TIMEOUT_MS = 12_000;

const FEITUAN_MANUAL_DELIVERY_TITLE = '未指定配送点，请按我填写的地址安排配送。';
const FEITUAN_MANUAL_DELIVERY_SUB =
  '未指定配送点;我们将根据你填写的地址电话联系你确认取餐方式。请留下可接听的电话。';

function normalizeAddrForCompare(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function normalizeDeliveryMatchKey(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** 将历史订单的配送选择映射到当前项目配送点 id（跨项目时按快照名称对齐） */
function mapHistoryOrderToCurrentDeliveryId(
  d: OrderDoc,
  points: MockDeliveryPoint[]
): string {
  if (d.isManualMatch || !d.deliveryPointId) {
    return OTHER_DELIVERY_ID;
  }
  if (points.some((p) => p.id === d.deliveryPointId)) {
    return d.deliveryPointId;
  }
  const snapName = d.deliveryPointSnapshot?.name?.trim();
  if (snapName && points.length > 0) {
    const n = normalizeDeliveryMatchKey(snapName);
    const byName = points.find((p) => normalizeDeliveryMatchKey(p.name) === n);
    if (byName) return byName.id;
    const byCode = points.find(
      (p) => p.code?.trim() && normalizeDeliveryMatchKey(p.code.trim()) === n
    );
    if (byCode) return byCode.id;
    const loose = points.find((p) => {
      const pn = normalizeDeliveryMatchKey(p.name);
      return pn.includes(n) || n.includes(pn);
    });
    if (loose) return loose.id;
  }
  return OTHER_DELIVERY_ID;
}

function feituanComparableLastOrder(
  d: OrderDoc | null,
  currentProjectId: string,
  currentAddress: string
): boolean {
  if (!d) return false;
  if (d.projectId === currentProjectId) return true;
  const a = normalizeAddrForCompare(d.customerAddress ?? '');
  const b = normalizeAddrForCompare(currentAddress);
  return a.length >= 2 && b.length >= 2 && a === b;
}

/** 饭团：按地址得到系统推荐配送 id（首项或「未指定」） */
function feituanRecommendDeliveryIdForAddress(
  addr: string,
  points: MockDeliveryPoint[]
): string {
  const line = addr.trim();
  if (line.length < 2) return '';
  if (points.length === 0) return OTHER_DELIVERY_ID;
  const m = suggestDeliveryPointsFromAddress(line, points);
  return m.length > 0 ? m[0].id : OTHER_DELIVERY_ID;
}

function feituanDeliveryChoiceLabel(id: string, points: MockDeliveryPoint[]): string {
  if (id === OTHER_DELIVERY_ID) return '未指定配送点（按地址联系安排）';
  const p = points.find((x) => x.id === id);
  if (!p) return '配送点';
  return p.code?.trim() ? `${p.name}（${p.code.trim()}）` : p.name;
}

function projectAllowsCustomerOrder(project: ProjectDoc): boolean {
  if (project.status === 'draft') return false;
  if (project.status === 'closed') return false;
  const closes = project.closesAt?.toDate?.();
  if (closes && closes.getTime() <= Date.now()) return false;
  return true;
}

export default function OrderForm() {
  const { user } = useAuthUser();
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug?: string;
    projectId: string;
  }>();
  const isFeituanOrder = !shopSlug;
  const ft = (feituanCls: string, shopCls: string) =>
    feituanOrShopGreen(isFeituanOrder, feituanCls, shopCls);
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state ?? {}) as CartLocationState;
  const lines = (incoming.lines ?? []).filter(Boolean);
  const bundleSelections = (incoming.bundleSelections ?? []).filter(Boolean);
  const projectTitleState = incoming.projectTitle ?? '当前项目';
  const returnCartDraft = useMemo(() => {
    if (incoming.cartDraft && Object.keys(incoming.cartDraft).length > 0) {
      return incoming.cartDraft;
    }
    const draft: Record<string, number> = {};
    for (const l of lines) {
      draft[l.productId] = l.quantity;
    }
    return draft;
  }, [incoming.cartDraft, lines]);

  const [resolvedShopSlug, setResolvedShopSlug] = useState(shopSlug);
  const base = isFeituanOrder
    ? `/feituan/projects/${encodeURIComponent(projectId)}`
    : `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  /** 仅在选择「以上都不对」时展示，与「详细地址」拆分 */
  const [addressSupplement, setAddressSupplement] = useState('');
  const [note, setNote] = useState('');
  const [deliveryId, setDeliveryId] = useState<string>('');
  /** 用户对当前推测配送点点「否」后记录候选 id；推测变化时需重新确认 */
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<string[]>(
    []
  );
  /** 配送点「查看详情」弹窗：当前展示的配送点 id */
  const [deliveryDetailModalId, setDeliveryDetailModalId] = useState<string | null>(
    null
  );
  const feituanDeliveryOverrideRef = useRef(false);
  const feituanAutoAddressKeyRef = useRef('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitHint, setSubmitHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [points, setPoints] = useState<MockDeliveryPoint[]>([]);
  /** 饭团：用于与当前推荐配送对比的「最近一单」快照（预填来源） */
  const [feituanCompareOrder, setFeituanCompareOrder] = useState<OrderDoc | null>(null);
  const contactPrefilledRef = useRef(false);
  const [didPrefillFromLastOrder, setDidPrefillFromLastOrder] = useState(false);

  useEffect(() => {
    contactPrefilledRef.current = false;
    setFeituanCompareOrder(null);
  }, [projectId]);

  useEffect(() => {
    const deliveryUiStep = isFeituanOrder ? 1 : 2;
    if (step !== deliveryUiStep) setDeliveryDetailModalId(null);
  }, [isFeituanOrder, step]);

  useEffect(() => {
    if (!deliveryDetailModalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeliveryDetailModalId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deliveryDetailModalId]);

  useEffect(() => {
    if (!deliveryDetailModalId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [deliveryDetailModalId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        setBooting(true);
        setBootErr(null);
        try {
          const projectPromise = withTimeout(
            getProject(decodeURIComponent(projectId)),
            LOAD_TIMEOUT_MS,
            '项目加载'
          );
          const [projectRow, shopRow] = isFeituanOrder
            ? await (async () => {
                const p = await projectPromise;
                const s = p
                  ? await withTimeout(getShopById(p.data.shopId), LOAD_TIMEOUT_MS, '店铺加载')
                  : null;
                return [p, s] as const;
              })()
            : await (async () => {
                const [s, p] = await Promise.all([
                  withTimeout(
                    getShopBySlug(decodeURIComponent(shopSlug)),
                    LOAD_TIMEOUT_MS,
                    '店铺加载'
                  ),
                  projectPromise,
                ]);
                return [p, s] as const;
              })();
          if (!shopRow) {
            if (!cancelled) setBootErr('店铺不存在或链接有误。');
            return;
          }
          if (!isShopOpenForCustomers(shopRow.data)) {
            if (!cancelled) setBootErr('该店铺已停用，暂不可下单。');
            return;
          }
          if (!projectRow) {
            if (!cancelled) setBootErr('项目不存在或已删除。');
            return;
          }
          if (projectRow.data.shopId !== shopRow.id) {
            if (!cancelled) setBootErr('项目与店铺不匹配。');
            return;
          }
          if (projectRow.data.feituanStatus === 'listed' && !isFeituanOrder) {
            if (!cancelled) setBootErr('该项目已在大马饭团上架，请从饭团入口参团。');
            return;
          }
          if (isFeituanOrder && projectRow.data.feituanStatus !== 'listed') {
            if (!cancelled) setBootErr('该项目尚未在大马饭团上架。');
            return;
          }

          let uiPoints: MockDeliveryPoint[] = [];
          if (isFeituanOrder) {
            uiPoints = await withTimeout(
              listActiveFeituanDeliveryPointsForProject(projectRow.data),
              LOAD_TIMEOUT_MS,
              '饭团配送点加载'
            );
          }
          if (uiPoints.length === 0) {
            const allPoints = await withTimeout(
              listDeliveryPointsByOwnerId(shopRow.data.ownerId, {
                fallbackShopId: shopRow.id,
              }),
              LOAD_TIMEOUT_MS,
              '配送点加载'
            );
            const allowed = new Set(projectRow.data.deliveryPointIds ?? []);
            const filtered =
              allowed.size > 0
                ? allPoints.filter((p) => allowed.has(p.id))
                : allPoints;

            uiPoints = filtered.map((p) => ({
              id: p.id,
              name: p.data.shortName ?? p.data.name,
              code: p.data.code,
              detailAddress: p.data.detailAddress,
              imageUrl: p.data.imageUrl,
            }));
          }

          if (!cancelled) {
            setResolvedShopSlug(shopRow.data.slug);
            setProject(projectRow.data);
            setPoints(uiPoints);
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setBootErr(toLoadErrorMessage(err, '加载失败，请重试。'));
          }
        } finally {
          if (!cancelled) setBooting(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [isFeituanOrder, projectId, shopSlug]);

  /** 第二次及以后下单：按上一笔订单预填（可改；备注不预填）。饭团入口跨项目共用 customerKey。 */
  useEffect(() => {
    if (!project || booting || bootErr || contactPrefilledRef.current) return;
    const pid = decodeURIComponent(projectId);
    let cancelled = false;

    const applyFromOrder = (d: OrderDoc) => {
      if (cancelled || contactPrefilledRef.current) return;
      contactPrefilledRef.current = true;
      setDidPrefillFromLastOrder(true);
      setName((n) => (n.trim() !== '' ? n : d.customerName?.trim() ?? ''));
      setPhone((p) => (p.trim() !== '' ? p : d.customerPhone?.trim() ?? ''));

      const addr = d.customerAddress?.trim() ?? '';
      if (isFeituanOrder) {
        setFeituanCompareOrder(d);
        setAddress((a) => (a.trim() !== '' ? a : addr));
        setDismissedSuggestionIds([]);
        return;
      }
      const nextDeliveryId = (() => {
        const pointOk =
          Boolean(d.deliveryPointId) &&
          !d.isManualMatch &&
          points.some((p) => p.id === d.deliveryPointId);
        return pointOk && d.deliveryPointId ? d.deliveryPointId : OTHER_DELIVERY_ID;
      })();

      setDeliveryId(nextDeliveryId);
      setAddress((a) => (a.trim() !== '' ? a : addr));
      setDismissedSuggestionIds([]);
    };

    const promise = isFeituanOrder
      ? listFeituanOrdersForCustomer({
          customerKey: getOrCreateCustomerKey(),
          customerUserId: user?.phoneNumber ? user.uid : undefined,
          wechatNotifyOAuthStateId: getWechatNotifyOAuthStateId(),
        })
      : listOrdersByCustomer(pid, getOrCreateCustomerKey());

    void promise
      .then((rows) => {
        if (cancelled || contactPrefilledRef.current) return;
        const usable = rows
          .filter((r) => r.data.status !== 'cancelled')
          .sort(
            (a, b) =>
              (b.data.createdAt?.toMillis?.() ?? 0) -
              (a.data.createdAt?.toMillis?.() ?? 0)
          );
        const prev = usable[0];
        if (!prev) return;
        applyFromOrder(prev.data);
      })
      .catch(() => {
        /* 静默失败，仍可手动填写 */
      });
    return () => {
      cancelled = true;
    };
  }, [project, booting, bootErr, projectId, points, isFeituanOrder, user?.phoneNumber, user?.uid]);

  const resolvedProjectTitle = project?.title?.trim() || projectTitleState;
  const projectDeliveryLabel = useMemo(() => {
    if (!project) return '—';
    if (isProjectRecurring(project)) {
      return formatEstimatedDeliveryHint(project);
    }
    return resolveProjectDeliveryLabel(project) || '—';
  }, [project]);
  const recurringConsumerNotice = useMemo(() => {
    if (!project || !isProjectRecurring(project)) return '';
    return project.recurringSchedule?.consumerNoticeText?.trim() ?? '';
  }, [project]);
  const canPlaceOrder = project ? projectAllowsCustomerOrder(project) : false;

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    [lines]
  );

  const deliveryLabel = useMemo(() => {
    if (!deliveryId) return '';
    if (deliveryId === OTHER_DELIVERY_ID) {
      return isFeituanOrder ? FEITUAN_MANUAL_DELIVERY_TITLE : '以上都不对（其他）';
    }
    const p = points.find((x) => x.id === deliveryId);
    if (!p) return '';
    return p.code?.trim() ? `${p.name}（${p.code.trim()}）` : p.name;
  }, [deliveryId, isFeituanOrder, points]);

  const deliverySnapshot = useMemo(() => {
    if (!deliveryId || deliveryId === OTHER_DELIVERY_ID) return { name: '', detail: undefined as string | undefined };
    const p = points.find((x) => x.id === deliveryId);
    const detailParts = [p?.detailAddress, p?.deliveryTime].filter(Boolean);
    return {
      name: p?.name ?? '',
      detail: detailParts.length ? detailParts.join(' · ') : undefined,
    };
  }, [deliveryId, points]);

  const deliveryDetailModalPoint = useMemo(() => {
    if (!deliveryDetailModalId) return null;
    return points.find((x) => x.id === deliveryDetailModalId) ?? null;
  }, [deliveryDetailModalId, points]);

  /** 饭团：地址驱动，始终根据地址列出匹配配送点 */
  const matchedPoints = useMemo(() => {
    if (!isFeituanOrder) return null;
    const line = address.trim();
    if (line.length < 2 || points.length === 0) return [];
    return suggestDeliveryPointsFromAddress(line, points);
  }, [address, isFeituanOrder, points]);

  const currentProjectIdDecoded = useMemo(
    () => decodeURIComponent(projectId),
    [projectId]
  );

  const feituanComparableToLastOrder = useMemo(
    () =>
      Boolean(
        isFeituanOrder &&
          feituanComparableLastOrder(
            feituanCompareOrder,
            currentProjectIdDecoded,
            address
          )
      ),
    [isFeituanOrder, feituanCompareOrder, currentProjectIdDecoded, address]
  );

  const feituanLastMappedDeliveryId = useMemo(() => {
    if (!isFeituanOrder || !feituanCompareOrder) return null;
    return mapHistoryOrderToCurrentDeliveryId(feituanCompareOrder, points);
  }, [isFeituanOrder, feituanCompareOrder, points]);

  const feituanLastDeliveryDisplayLabel = useMemo(() => {
    if (feituanLastMappedDeliveryId == null) return '';
    return feituanDeliveryChoiceLabel(feituanLastMappedDeliveryId, points);
  }, [feituanLastMappedDeliveryId, points]);

  const feituanRecommendedDeliveryId = useMemo(
    () => (isFeituanOrder ? feituanRecommendDeliveryIdForAddress(address, points) : ''),
    [isFeituanOrder, address, points]
  );

  const feituanRecommendedDisplayLabel = useMemo(
    () =>
      feituanRecommendedDeliveryId
        ? feituanDeliveryChoiceLabel(feituanRecommendedDeliveryId, points)
        : '',
    [feituanRecommendedDeliveryId, points]
  );

  /** 地址与预填来源上一单快照一致（用户未改地址），才做「与上一单配送」对比 */
  const feituanAddrUnchangedVsLastOrderSnapshot = useMemo(
    () => {
      if (!isFeituanOrder || !feituanCompareOrder) return false;
      const cur = normalizeAddrForCompare(address);
      const prev = normalizeAddrForCompare(feituanCompareOrder.customerAddress ?? '');
      return cur.length >= 2 && prev.length >= 2 && cur === prev;
    },
    [isFeituanOrder, feituanCompareOrder, address]
  );

  const feituanDeliveryConflictVersusLast = useMemo(
    () =>
      Boolean(
        isFeituanOrder &&
          feituanCompareOrder &&
          feituanComparableToLastOrder &&
          feituanAddrUnchangedVsLastOrderSnapshot &&
          address.trim().length >= 2 &&
          feituanLastMappedDeliveryId != null &&
          feituanRecommendedDeliveryId !== '' &&
          feituanRecommendedDeliveryId !== feituanLastMappedDeliveryId
      ),
    [
      isFeituanOrder,
      feituanCompareOrder,
      feituanComparableToLastOrder,
      feituanAddrUnchangedVsLastOrderSnapshot,
      address,
      feituanLastMappedDeliveryId,
      feituanRecommendedDeliveryId,
    ]
  );

  /** 饭团：地址不少于 2 字后自动选首个匹配配送点；无匹配或项目无配送点则选「未指定配送点」。用户改选手动项后不再覆盖，直至地址变更。 */
  useEffect(() => {
    if (!isFeituanOrder || booting || !project) return;
    const line = address.trim();
    if (line.length < 2) {
      feituanDeliveryOverrideRef.current = false;
      feituanAutoAddressKeyRef.current = '';
      setDeliveryId('');
      return;
    }
    if (feituanAutoAddressKeyRef.current !== line) {
      feituanAutoAddressKeyRef.current = line;
      feituanDeliveryOverrideRef.current = false;
    }
    if (feituanDeliveryOverrideRef.current) return;

    if (points.length === 0) {
      setDeliveryId(OTHER_DELIVERY_ID);
      return;
    }
    const m = suggestDeliveryPointsFromAddress(line, points);
    setDeliveryId(m.length > 0 ? m[0].id : OTHER_DELIVERY_ID);
  }, [isFeituanOrder, booting, project, address, points]);

  const suggestedPoints = useMemo(() => {
    if (isFeituanOrder) return null;
    if (deliveryId !== OTHER_DELIVERY_ID) return null;
    const line = address.trim();
    if (line.length < 2) return null;
    const dismissed = new Set(dismissedSuggestionIds);
    const candidates = suggestDeliveryPointsFromAddress(line, points).filter(
      (point) => !dismissed.has(point.id)
    );
    return candidates.length > 0 ? candidates : null;
  }, [deliveryId, address, isFeituanOrder, points, dismissedSuggestionIds]);

  const resolvedCustomerAddress = useMemo(() => {
    const main = address.trim();
    if (isFeituanOrder) {
      if (deliveryId === OTHER_DELIVERY_ID) return main;
      if (deliveryId && deliveryId !== OTHER_DELIVERY_ID) return main;
      return '';
    }
    if (deliveryId === OTHER_DELIVERY_ID) {
      const sup = addressSupplement.trim();
      if (!main && !sup) return '';
      if (main && sup) return `${main}\n补充：${sup}`;
      return main || sup;
    }
    if (deliveryId && deliveryId !== OTHER_DELIVERY_ID) {
      const p = points.find((x) => x.id === deliveryId);
      if (p) {
        const bits = [p.name, p.detailAddress].filter(Boolean);
        return bits.length ? `配送点：${bits.join(' · ')}` : `配送点：${p.name}`;
      }
    }
    return '';
  }, [address, addressSupplement, deliveryId, isFeituanOrder, points]);

  const canGoShopInfoStep =
    canPlaceOrder && name.trim().length > 0 && phone.trim().length > 0;

  const canGoFeituanFill =
    canPlaceOrder &&
    name.trim().length > 0 &&
    address.trim().length > 0 &&
    deliveryId.length > 0;

  const otherNeedsResolve =
    !isFeituanOrder &&
    deliveryId === OTHER_DELIVERY_ID &&
    suggestedPoints !== null &&
    suggestedPoints.length > 0;

  const canGoShopDeliveryStep =
    canPlaceOrder &&
    deliveryId.length > 0 &&
    (deliveryId === OTHER_DELIVERY_ID
      ? address.trim().length > 0 && !otherNeedsResolve
      : true);
  const canSubmitOrder = isFeituanOrder ? canGoFeituanFill : canGoShopDeliveryStep;

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitHint(null);
    if (!canPlaceOrder || !canSubmitOrder || submitting) return;
    const isManualMatch = deliveryId === OTHER_DELIVERY_ID;
    const addrOut = resolvedCustomerAddress;
    if (!addrOut.trim()) {
      setSubmitError(isFeituanOrder ? '请填写地址。' : '请填写或确认配送地址信息。');
      return;
    }
    const customerKey = getOrCreateCustomerKey();
    try {
      setSubmitting(true);
      const { orderId, orderNumber, timedPromoPaymentDueAt } = await createOrder({
        shopSlug: resolvedShopSlug,
        projectId,
        channel: isFeituanOrder ? 'feituan' : 'shop',
        customerKey,
        customerUserId: isFeituanOrder && user?.phoneNumber ? user.uid : undefined,
        customerPhoneMasked:
          isFeituanOrder && user?.phoneNumber
            ? `****${user.phoneNumber.replace(/\D/g, '').slice(-4)}`
            : undefined,
        wechatNotifyOAuthStateId: getWechatNotifyOAuthStateId(),
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerAddress: addrOut,
        customerNote: note.trim() || undefined,
        deliveryPointId: isManualMatch ? undefined : deliveryId,
        deliveryPointLabel: isManualMatch
          ? isFeituanOrder
            ? `${FEITUAN_MANUAL_DELIVERY_TITLE} ${FEITUAN_MANUAL_DELIVERY_SUB} ${addrOut}`
            : `其他（将按地址手动匹配）：${addrOut}`
          : deliveryLabel,
        deliverySnapshot:
          isManualMatch || !deliverySnapshot.name
            ? undefined
            : { name: deliverySnapshot.name, detail: deliverySnapshot.detail },
        isManualMatch,
        lines,
        bundleSelections,
      });
      void sendOrderSubmittedWechatNotification({ orderId, customerKey }).catch(() => {
        /* 微信通知失败不影响下单 */
      });
      if (timedPromoPaymentDueAt) {
        const dueText = new Date(timedPromoPaymentDueAt).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        setSubmitHint(`订单已提交：含限时优惠，请在30分钟内付款（截止 ${dueText}）`);
      } else {
        setSubmitHint('提交成功，正在跳转订单详情…');
      }
      await new Promise((resolve) => window.setTimeout(resolve, timedPromoPaymentDueAt ? 1200 : 280));
      navigate(`${base}/orders/${encodeURIComponent(orderNumber)}`, {
        replace: true,
      });
    } catch (error) {
      if (error instanceof CreateOrderError) {
        setSubmitError(error.message);
      } else if (error instanceof FirebaseError) {
        if (error.code === 'permission-denied') {
          setSubmitError('没有写入权限，请检查 Firestore 规则。');
        } else if (error.code === 'unavailable') {
          setSubmitError('网络不可用，请稍后重试。');
        } else {
          setSubmitError(`提交失败（${error.code}），请重试。`);
        }
      } else {
        setSubmitError('提交失败，请检查网络后重试。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (lines.length === 0 && bundleSelections.length === 0) {
    return (
      <PageShell title="填写订单" subtitle="尚未选择菜品">
        <div className="space-y-3 text-sm text-gray-600">
          <p>还没有从首页带过来的选菜记录。</p>
          <Link
            className="text-indigo-600 underline-offset-2 hover:underline"
            to={base}
          >
            返回项目首页选菜
          </Link>
        </div>
      </PageShell>
    );
  }

  if (booting) {
    return (
      <PageShell title="填写订单" subtitle="加载中">
        <p className="text-sm text-gray-600">正在加载项目与配送点…</p>
      </PageShell>
    );
  }

  if (bootErr || !project) {
    return (
      <PageShell title="填写订单" subtitle="无法下单">
        <p className="text-sm text-red-600">{bootErr ?? '加载失败'}</p>
        <Link
          className="mt-4 inline-flex text-sm text-indigo-600 underline-offset-2 hover:underline"
          to={base}
        >
          返回项目首页
        </Link>
      </PageShell>
    );
  }

  const inputCls = `mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[16px] text-gray-900 outline-none ${ft(
    FEITUAN_TW.inputFocus,
    'ring-emerald-500/30 focus:border-emerald-500 focus:ring-2'
  )}`;
  const primaryBtnCls = ft(
    'inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-[#0F8F5F] px-3 text-sm font-semibold text-white disabled:bg-gray-300',
    'inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-gray-300'
  );

  const blockedHint = !canPlaceOrder ? (
    <p className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      当前项目不可下单（草稿 / 已截止 / 已过截止时间）。你仍可查看页面与订单记录。
    </p>
  ) : null;

  const activeStep: Step = canPlaceOrder ? step : 1;
  const stepTotal = isFeituanOrder ? 2 : 3;
  const onFeituanAddressChange = (value: string) => {
    setAddress(value);
    setDismissedSuggestionIds([]);
  };

  const feituanLabelCls = 'w-14 shrink-0 text-sm text-gray-600';
  const feituanFieldWrapCls = 'min-w-0 flex-1';
  const feituanRowInputCls = `block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[16px] text-gray-900 outline-none ${ft(
    FEITUAN_TW.inputFocus,
    'ring-emerald-500/30 focus:border-emerald-500 focus:ring-2'
  )}`;

  const renderDeliveryPointPicker = (list: MockDeliveryPoint[]) => (
    <div className="grid grid-cols-2 gap-2">
      {list.map((p) => {
        const selected = deliveryId === p.id;
        return (
          <label
            key={p.id}
            className={`relative flex cursor-pointer flex-col rounded-xl border p-2.5 transition-colors ${
              selected
                ? ft(
                    FEITUAN_TW.selectedSoft,
                    'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-500/35'
                  )
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <input
              type="radio"
              name="delivery"
              className="sr-only"
              value={p.id}
              checked={selected}
              onChange={() => {
                feituanDeliveryOverrideRef.current = true;
                setDeliveryId(p.id);
              }}
            />
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] leading-tight text-gray-500">
                  编号{' '}
                  <span className="font-medium text-gray-700">
                    {(p.code && p.code.trim()) || '—'}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-gray-900">{p.name}</p>
              </div>
              <span
                className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                  selected
                    ? ft(
                        FEITUAN_TW.radioSelected,
                        'border-emerald-600 bg-emerald-600 ring-2 ring-white ring-inset'
                      )
                    : 'border-gray-300 bg-white'
                }`}
                aria-hidden
              />
            </div>
            <button
              type="button"
              className="mt-2 w-fit text-left text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDeliveryDetailModalId(p.id);
              }}
            >
              查看详情
            </button>
          </label>
        );
      })}
    </div>
  );

  return (
    <PageShell
      title="填写订单"
      subtitle={`步骤 ${activeStep} / ${stepTotal} · ${resolvedProjectTitle}`}
    >
      {blockedHint}
      {recurringConsumerNotice ? (
        <p className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-950">
          {recurringConsumerNotice}
        </p>
      ) : null}

      <div className="mb-4 flex gap-2 text-xs text-gray-500">
        {isFeituanOrder ? (
          <>
            <span className={activeStep >= 1 ? 'font-semibold text-gray-900' : ''}>① 填写</span>
            <span>→</span>
            <span className={activeStep >= 2 ? 'font-semibold text-gray-900' : ''}>② 确认</span>
          </>
        ) : (
          <>
            <span className={activeStep >= 1 ? 'font-semibold text-gray-900' : ''}>① 信息</span>
            <span>→</span>
            <span className={activeStep >= 2 ? 'font-semibold text-gray-900' : ''}>② 配送</span>
            <span>→</span>
            <span className={activeStep >= 3 ? 'font-semibold text-gray-900' : ''}>③ 确认</span>
          </>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <div className="mb-1 font-medium text-gray-900">已选菜品</div>
        <ul className="space-y-1">
          {lines.map((l: OrderLine) => (
            <li key={l.productId} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {l.name} ×{l.quantity}
                {l.isDiscount ? (
                  <span className="ml-1 text-xs text-amber-700">早鸟</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMYR(l.unitPrice * l.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900">
          <span>合计</span>
          <span>{formatMYR(totalAmount)}</span>
        </div>
      </div>

      {activeStep === 1 && isFeituanOrder ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">填写订单</h2>
          <section
            className="rounded-2xl border px-3.5 py-3.5 shadow-sm"
            style={{ borderColor: FEITUAN_HOME.primaryBorder, backgroundColor: FEITUAN_HOME.card }}
          >
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <span className={feituanLabelCls}>姓名：</span>
                <span className={feituanFieldWrapCls}>
                  <input
                    className={feituanRowInputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="必填"
                  />
                </span>
              </label>

              <div>
                <label className="flex items-center gap-2">
                  <span className={feituanLabelCls}>电话：</span>
                  <span className={feituanFieldWrapCls}>
              <input
                className={feituanRowInputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="建议填写"
                    />
                  </span>
                </label>
                <p className="ml-[4.5rem] mt-1.5 text-xs leading-relaxed text-gray-500">
                  建议留下可接听的电话。若配送点无法匹配，我们将电话联系你安排取餐。
                </p>
              </div>

              <label className="flex items-center gap-2">
                <span className={feituanLabelCls}>备注：</span>
                <span className={feituanFieldWrapCls}>
              <input
                className={feituanRowInputCls}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="选填"
                  />
                </span>
              </label>

              <label className="flex items-start gap-2">
                <span className={`${feituanLabelCls} pt-2.5`}>地址：</span>
                <span className={`${feituanFieldWrapCls} relative`}>
                  <textarea
                    className={`${feituanRowInputCls} min-h-[80px] resize-y pr-12`}
                  value={address}
                  onChange={(e) => onFeituanAddressChange(e.target.value)}
                  autoComplete="street-address"
                  placeholder="小区、大厦、片区等"
                />
                {address.trim() ? (
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 shadow-sm"
                    onClick={() => onFeituanAddressChange('')}
                  >
                    清空
                  </button>
                ) : null}
                </span>
              </label>
            </div>
          </section>

          <section
            className="rounded-2xl border px-3.5 py-3.5 shadow-sm"
            style={{ borderColor: FEITUAN_HOME.primaryBorder, backgroundColor: FEITUAN_HOME.card }}
          >
            <p className="mb-2 text-sm font-semibold text-gray-900">配送点</p>
            {feituanDeliveryConflictVersusLast ? (
              <div className="mb-2 space-y-2">
                <div
                  className="rounded-xl border-2 px-3 py-2.5"
                  style={{
                    borderColor: FEITUAN_HOME.warningBorder,
                    backgroundColor: FEITUAN_HOME.warningLight,
                  }}
                >
                  <p className="text-sm font-bold leading-snug" style={{ color: '#9a3412' }}>
                    匹配结果与上一单不同，请确认选择
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed" style={{ color: '#7c2d12' }}>
                    当前地址与上一单一致，但按最新配送点资料匹配的结果与上一单所选不一致。已默认「系统推荐」；请对比后点选其一，也可在下方列表中另选。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      feituanDeliveryOverrideRef.current = true;
                      setDeliveryId(feituanRecommendedDeliveryId);
                    }}
                    className={`rounded-xl border px-2.5 py-2.5 text-left transition ${
                      deliveryId === feituanRecommendedDeliveryId
                        ? 'border-amber-600 bg-amber-100 ring-2 ring-amber-500/35'
                        : 'border-gray-200 bg-white active:bg-gray-50'
                    }`}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                      系统推荐
                    </p>
                    <p className="mt-1 line-clamp-3 text-xs font-medium leading-snug text-gray-900">
                      {feituanRecommendedDisplayLabel}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      feituanDeliveryOverrideRef.current = true;
                      if (feituanLastMappedDeliveryId != null) {
                        setDeliveryId(feituanLastMappedDeliveryId);
                      }
                    }}
                    className={`rounded-xl border px-2.5 py-2.5 text-left transition ${
                      feituanLastMappedDeliveryId != null &&
                      deliveryId === feituanLastMappedDeliveryId
                        ? 'border-amber-600 bg-amber-100 ring-2 ring-amber-500/35'
                        : 'border-gray-200 bg-white active:bg-gray-50'
                    }`}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                      上一单所用
                    </p>
                    <p className="mt-1 line-clamp-3 text-xs font-medium leading-snug text-gray-900">
                      {feituanLastDeliveryDisplayLabel}
                    </p>
                  </button>
                </div>
              </div>
            ) : null}
            <div
              className="min-h-[5.5rem] rounded-xl border border-dashed px-3 py-3"
              style={{
                borderColor: FEITUAN_HOME.primaryBorder,
                backgroundColor: FEITUAN_HOME.primaryBg,
              }}
            >
              {points.length === 0 ? (
                <p className="text-center text-sm leading-relaxed text-gray-500">
                  当前项目尚未配置配送点。填写地址不少于 2 个字后，将自动选择「未指定配送点」。
                </p>
              ) : address.trim().length < 2 ? (
                <p className="text-center text-sm leading-relaxed text-gray-500">
                  填写地址不少于 2 个字后，将在此显示可能匹配的配送点，并自动选中第一项；若无匹配则自动选择「未指定配送点」。
                </p>
              ) : matchedPoints && matchedPoints.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs text-gray-600">可能匹配的配送点（可改选）</p>
                  {renderDeliveryPointPicker(matchedPoints)}
                </div>
              ) : (
                <p className="text-center text-sm leading-relaxed text-gray-600">
                  暂未匹配到配送点；已自动选择「未指定配送点」。
                </p>
              )}
            </div>

            <label
              className={`mt-3 flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/70 p-3 ${
                address.trim().length < 2 ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
              }`}
            >
              <input
                type="radio"
                name="delivery"
                className="mt-1 h-4 w-4 shrink-0"
                value={OTHER_DELIVERY_ID}
                disabled={address.trim().length < 2}
                checked={deliveryId === OTHER_DELIVERY_ID}
                onChange={() => {
                  if (address.trim().length < 2) return;
                  feituanDeliveryOverrideRef.current = true;
                  setDeliveryId(OTHER_DELIVERY_ID);
                }}
              />
              <span className="min-w-0 flex-1 text-sm text-gray-900">
                {FEITUAN_MANUAL_DELIVERY_TITLE}
                <span className="mt-1 block text-xs leading-relaxed text-amber-900">
                  {FEITUAN_MANUAL_DELIVERY_SUB}
                </span>
              </span>
            </label>
          </section>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() =>
                navigate(base, {
                  state: {
                    projectTitle: resolvedProjectTitle,
                    cartDraft: returnCartDraft,
                  },
                })
              }
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
            >
              再想想
            </button>
            <button
              type="button"
              className={primaryBtnCls}
              disabled={!canGoFeituanFill}
              onClick={() => setStep(2)}
            >
              下一步：确认订单
            </button>
          </div>

          {deliveryDetailModalPoint ? (
            <div
              className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="feituan-delivery-detail-title"
              onClick={() => setDeliveryDetailModalId(null)}
            >
              <div
                className="max-h-[min(85vh,640px)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:rounded-2xl sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
                  <div className="min-w-0 flex-1">
                    <h3
                      id="feituan-delivery-detail-title"
                      className="text-base font-semibold text-gray-900"
                    >
                      {deliveryDetailModalPoint.name}
                    </h3>
                    {deliveryDetailModalPoint.code?.trim() ? (
                      <p className="mt-1 text-xs text-gray-500">
                        编号 {deliveryDetailModalPoint.code.trim()}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 min-w-[2.25rem] shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    aria-label="关闭"
                    onClick={() => setDeliveryDetailModalId(null)}
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
                <div className="space-y-3 py-4 text-sm text-gray-700">
                  <div>
                    <p className="text-xs font-medium text-gray-500">详细地址</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {deliveryDetailModalPoint.detailAddress?.trim() || '暂无'}
                    </p>
                  </div>
                  {deliveryDetailModalPoint.deliveryTime ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">配送时间</p>
                      <p className="mt-1">{deliveryDetailModalPoint.deliveryTime}</p>
                    </div>
                  ) : null}
                  {deliveryDetailModalPoint.imageUrl ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">示意图</p>
                      <img
                        src={deliveryDetailModalPoint.imageUrl}
                        alt={`${deliveryDetailModalPoint.name} 配送点示意图`}
                        className="mt-2 max-h-[min(40vh,280px)] w-full rounded-xl object-contain"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mb-1 flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 sm:hidden"
                  onClick={() => setDeliveryDetailModalId(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeStep === 1 && !isFeituanOrder ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">填写信息</h2>
          {didPrefillFromLastOrder ? (
            <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
              已根据你在<strong>本项目上一笔订单</strong>自动填入姓名、电话，可直接修改。配送方式与地址在下一步填写或确认。
            </p>
          ) : null}
          <label className="block text-sm text-gray-700">
            姓名 <span className="text-red-600">*</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="例如：李美玲"
            />
          </label>
          <label className="block text-sm text-gray-700">
            电话 <span className="text-red-600">*</span>
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="例如：6012-3456789"
            />
          </label>
          <label className="block text-sm text-gray-700">
            备注 <span className="text-gray-400">（选填）</span>
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注请按需填写"
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() =>
                navigate(base, {
                  state: {
                    projectTitle: resolvedProjectTitle,
                    cartDraft: returnCartDraft,
                  },
                })
              }
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
            >
              再想想
            </button>
            <button
              type="button"
              className={primaryBtnCls}
              disabled={!canGoShopInfoStep}
              onClick={() => setStep(2)}
            >
              下一步：配送
            </button>
          </div>
        </div>
      ) : null}

      {activeStep === 2 && !isFeituanOrder ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">配送方式与地址</h2>
          <p className="text-sm text-gray-600">
            请先选择配送点；若没有合适的选项，再选择「以上都不对」并填写详细地址。
          </p>
          {didPrefillFromLastOrder ? (
            <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
              已带入<strong>上一笔订单</strong>的配送点与地址（如有），请确认是否仍正确。
            </p>
          ) : null}
          {points.length === 0 ? (
            <p className="text-sm text-amber-800">
              商户尚未配置可用配送点；请填写详细地址，由商户手动匹配。
            </p>
          ) : null}
          <div className="space-y-2">
            {points.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {points.map((p) => {
                  const selected = deliveryId === p.id;
                  return (
                    <label
                      key={p.id}
                      className={`relative flex cursor-pointer flex-col rounded-xl border p-2.5 transition-colors ${
                        selected
                          ? ft(
                              FEITUAN_TW.selectedSoft,
                              'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-500/35'
                            )
                          : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="delivery"
                        className="sr-only"
                        checked={selected}
                        onChange={() => {
                          setDeliveryId(p.id);
                          setDismissedSuggestionIds([]);
                          setAddress('');
                          setAddressSupplement('');
                        }}
                      />
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] leading-tight text-gray-500">
                            编号{' '}
                            <span className="font-medium text-gray-700">
                              {(p.code && p.code.trim()) || '—'}
                            </span>
                          </p>
                          <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
                            {p.name}
                          </p>
                        </div>
                        <span
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                            selected
                              ? ft(
                                  FEITUAN_TW.radioSelected,
                                  'border-emerald-600 bg-emerald-600 ring-2 ring-white ring-inset'
                                )
                              : 'border-gray-300 bg-white'
                          }`}
                          aria-hidden
                        />
                      </div>
                      <button
                        type="button"
                        className="mt-2 w-fit text-left text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeliveryDetailModalId(p.id);
                        }}
                      >
                        查看详情
                      </button>
                    </label>
                  );
                })}
              </div>
            ) : null}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              <input
                type="radio"
                name="delivery"
                className="mt-1 h-4 w-4"
                checked={deliveryId === OTHER_DELIVERY_ID}
                onChange={() => {
                  setDeliveryId(OTHER_DELIVERY_ID);
                  setDismissedSuggestionIds([]);
                }}
              />
              <span className="min-w-0 flex-1 text-sm text-gray-900">
                以上都不对（其他）
                <span className="mt-1 block text-xs text-amber-900">
                  填写你的详细地址；系统将尝试匹配配送点，无配送点的商户联系单独配送。
                </span>
              </span>
            </label>
          </div>

          {deliveryId === OTHER_DELIVERY_ID ? (
            <div className="space-y-3">
              <label className="block text-sm text-gray-700">
                详细地址 <span className="text-red-600">*</span>
                <div className="relative">
                  <textarea
                    className={`${inputCls} min-h-[100px] resize-y pr-14`}
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setDismissedSuggestionIds([]);
                    }}
                    autoComplete="street-address"
                    placeholder="楼栋、门牌、片区等，便于商户或骑手送达。"
                  />
                  {address.trim() ? (
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm"
                      onClick={() => {
                        setAddress('');
                        setDismissedSuggestionIds([]);
                      }}
                    >
                      清空
                    </button>
                  ) : null}
                </div>
              </label>
              <label className="block text-sm text-gray-700">
                补充地址 / 门牌 <span className="text-gray-400">（选填）</span>
                <textarea
                  className={`${inputCls} min-h-[72px] resize-y`}
                  value={addressSupplement}
                  onChange={(e) => setAddressSupplement(e.target.value)}
                  autoComplete="street-address"
                  placeholder="如需补充栋号、单元、联系人方式等可填写。"
                />
              </label>
              {suggestedPoints ? (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-3 py-3 text-sm text-indigo-950">
                  <p className="font-medium text-indigo-950">
                    根据你填的地址，系统找到 {suggestedPoints.length}{' '}
                    个可能的配送点，请选择一个；也可以选择「以上都不对」。
                  </p>
                  <div className="mt-3 space-y-2">
                    {suggestedPoints.map((point) => (
                      <div
                        key={point.id}
                        className="rounded-lg border border-indigo-100 bg-white/90 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-indigo-950">
                              {point.name}
                              {point.zoneName ? (
                                <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                                  {point.zoneName}
                                </span>
                              ) : null}
                            </p>
                            {point.detailAddress ? (
                              <p className="mt-1 text-xs text-indigo-900/90">
                                参考：{point.detailAddress}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
                            onClick={() => {
                              setDeliveryId(point.id);
                              setDismissedSuggestionIds([]);
                            }}
                          >
                            使用这个
                          </button>
                        </div>
                        {point.imageUrl ? (
                          <button
                            type="button"
                            className="mt-2 text-xs font-medium text-indigo-700 underline-offset-2 hover:underline"
                            onClick={() => setDeliveryDetailModalId(point.id)}
                          >
                            查看配送点示意图
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mt-2 text-xs font-medium text-indigo-700 underline-offset-2 hover:underline"
                            onClick={() => setDeliveryDetailModalId(point.id)}
                          >
                            查看配送点详情
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex h-10 flex-1 min-w-[8rem] items-center justify-center rounded-lg border border-indigo-200 bg-white px-3 text-sm font-medium text-indigo-900"
                      onClick={() =>
                        setDismissedSuggestionIds(
                          suggestedPoints.map((point) => point.id)
                        )
                      }
                    >
                      以上都不对，按单独地址配送
                    </button>
                  </div>
                  {otherNeedsResolve ? (
                    <p className="mt-2 text-xs text-indigo-800">
                      请选择一个候选配送点，或选择「以上都不对」后再进入下一步。
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
              onClick={() => setStep(1)}
            >
              上一步
            </button>
            <button
              type="button"
              className={primaryBtnCls}
              disabled={!canGoShopDeliveryStep}
              onClick={() => setStep(3)}
            >
              下一步：确认
            </button>
          </div>

          {deliveryDetailModalPoint ? (
            <div
              className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delivery-detail-title"
              onClick={() => setDeliveryDetailModalId(null)}
            >
              <div
                className="max-h-[min(85vh,640px)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:rounded-2xl sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
                  <div className="min-w-0 flex-1">
                    <h3
                      id="delivery-detail-title"
                      className="text-base font-semibold text-gray-900"
                    >
                      {deliveryDetailModalPoint.name}
                    </h3>
                    {(deliveryDetailModalPoint.code &&
                      deliveryDetailModalPoint.code.trim()) ? (
                      <p className="mt-1 text-xs text-gray-500">
                        编号 {deliveryDetailModalPoint.code.trim()}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 min-w-[2.25rem] shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    aria-label="关闭"
                    onClick={() => setDeliveryDetailModalId(null)}
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
                <div className="space-y-3 py-4 text-sm text-gray-700">
                  <div>
                    <p className="text-xs font-medium text-gray-500">详细地址</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {deliveryDetailModalPoint.detailAddress?.trim()
                        ? deliveryDetailModalPoint.detailAddress
                        : '暂无'}
                    </p>
                  </div>
                  {deliveryDetailModalPoint.deliveryTime ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">配送时间</p>
                      <p className="mt-1">{deliveryDetailModalPoint.deliveryTime}</p>
                    </div>
                  ) : null}
                  {deliveryDetailModalPoint.imageUrl ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">示意图</p>
                      <img
                        src={deliveryDetailModalPoint.imageUrl}
                        alt={`${deliveryDetailModalPoint.name} 配送点示意图`}
                        className="mt-2 w-full max-h-[min(40vh,280px)] rounded-xl object-contain"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mb-1 flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 sm:hidden"
                  onClick={() => setDeliveryDetailModalId(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {(isFeituanOrder ? activeStep === 2 : activeStep === 3) ? (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">确认并提交</h2>
          <div className="rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm text-gray-800">
            <div className="font-medium text-gray-900">顾客信息</div>
            <p className="mt-1">姓名：{name.trim()}</p>
            <p>
              电话：
              {phone.trim() ? (
                phone.trim()
              ) : (
                <span className="text-amber-800">未填写（建议返回补充，便于我们联系你）</span>
              )}
            </p>
            {note.trim() ? <p>备注：{note.trim()}</p> : <p>备注：（无）</p>}
            <p className="mt-3">
              <span className="font-medium text-gray-900">
                {project && isProjectRecurring(project)
                  ? '预计配送（按付款时间）：'
                  : '配送时间：'}
              </span>
              <span className={ft('font-semibold text-emerald-800', 'font-medium')}>
                {projectDeliveryLabel}
              </span>
            </p>
            <div className="mt-3 font-medium text-gray-900">配送地址</div>
            <p className="mt-1">方式：{deliveryLabel}</p>
            <p className="mt-1 break-words">地址：{resolvedCustomerAddress || '—'}</p>
            {isFeituanOrder && deliveryId === OTHER_DELIVERY_ID ? (
              <p className="mt-2 text-xs text-gray-500">{FEITUAN_MANUAL_DELIVERY_SUB}</p>
            ) : null}
          </div>
          <p className="text-xs text-gray-500">提交后会写入数据库，并进行库存校验。</p>
          {submitError ? (
            <p className="text-sm text-red-600">{submitError}</p>
          ) : null}
          {submitHint ? (
            <p className={`text-sm ${ft(FEITUAN_TW.hint, 'text-emerald-700')}`}>{submitHint}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
              onClick={() => setStep(isFeituanOrder ? 1 : 2)}
              disabled={submitting || !canPlaceOrder}
            >
              上一步
            </button>
            <button
              type="button"
              className={primaryBtnCls}
              onClick={handleSubmit}
              disabled={submitting || !canPlaceOrder || !canSubmitOrder}
            >
              {submitting ? '提交中…' : '提交订单'}
            </button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
