import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FeituanContactFields } from '../components/feituan/FeituanContactFields';
import { FeituanFlowHeader } from '../components/feituan/FeituanFlowHeader';
import { useAuthUser } from '../hooks/useAuthUser';
import { notifyFeituanCartUpdated } from '../hooks/useFeituanCartCount';
import { OTHER_DELIVERY_ID } from '../data/mockDeliveryPoints';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import { listActiveFeituanDeliveryPointsForProject } from '../lib/feituanDeliveryService';
import { suggestDeliveryPointsFromAddress } from '../lib/deliveryPointMatch';
import {
  buildLinesFromCartDraft,
  rebuildBundleSelectionsPrices,
  validateProjectRowForCart,
} from '../lib/feituanCartLines';
import {
  clearFeituanCart,
  createFeituanPaymentRef,
  getFeituanCart,
  removeFeituanCartProject,
} from '../lib/feituanCartStorage';
import { formatMYR } from '../lib/formatMYR';
import { FEITUAN_TW } from '../lib/feituanHomeTheme';
import { formatEstimatedDeliveryHint, isProjectRecurring } from '../lib/recurringDeliverySchedule';
import { createOrder, CreateOrderError, listFeituanOrdersForCustomer } from '../lib/orderService';
import { getProject } from '../lib/projectService';
import { getShopById } from '../lib/shopService';
import { getWechatNotifyOAuthStateId } from '../lib/wechatService';
import type { FeituanCartProject } from '../types/feituanCart';
import type { MockDeliveryPoint } from '../types/orderDraft';

const FEITUAN_MANUAL_DELIVERY_TITLE = '未指定配送点，请按我填写的地址安排配送。';
const FEITUAN_MANUAL_DELIVERY_SUB =
  '未指定配送点;我们将根据你填写的地址电话联系你确认取餐方式。请留下可接听的电话。';

type CheckoutLine = {
  cart: FeituanCartProject;
  lines: FeituanCartProject['lines'];
  bundleSelections: FeituanCartProject['bundleSelections'];
  subtotal: number;
  shopSlug: string;
  recurringHint?: string;
};

export default function FeituanCartCheckout() {
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const customerKey = getOrCreateCustomerKey();
  const contactPrefilledRef = useRef(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [points, setPoints] = useState<MockDeliveryPoint[]>([]);
  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const cart = getFeituanCart();
      if (!cart.projects.length) {
        if (!cancelled) {
          setLoading(false);
          setErr('购物车为空');
        }
        return;
      }
      const now = new Date();
      const built: CheckoutLine[] = [];
      const failIds: string[] = [];
      for (const entry of cart.projects) {
        const row = await getProject(entry.projectId);
        if (!row) {
          failIds.push(entry.projectId);
          continue;
        }
        const shopRow = await getShopById(row.data.shopId);
        const slug = shopRow?.data.slug ?? '';
        const bundleSelections = rebuildBundleSelectionsPrices(
          row.data,
          entry.bundleSelections,
          now
        );
        const builtLines = buildLinesFromCartDraft(
          row.data,
          entry.cartDraft,
          bundleSelections,
          now
        );
        const validation = validateProjectRowForCart(
          row,
          builtLines.lines,
          builtLines.bundleSelections,
          now
        );
        if (!validation.ok) {
          failIds.push(entry.projectId);
          continue;
        }
        built.push({
          cart: entry,
          lines: builtLines.lines,
          bundleSelections: builtLines.bundleSelections,
          subtotal: builtLines.subtotal,
          shopSlug: slug,
          recurringHint: isProjectRecurring(row.data)
            ? formatEstimatedDeliveryHint(row.data)
            : undefined,
        });
      }
      if (!cancelled) {
        for (const id of failIds) removeFeituanCartProject(id);
        notifyFeituanCartUpdated();
        setLines(built);
        if (built.length === 0) {
          setErr('没有可结算的项目，请返回购物车处理');
        } else {
          const pts = await listActiveFeituanDeliveryPointsForProject(
            (await getProject(built[0]!.cart.projectId))!.data
          );
          setPoints(pts);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (contactPrefilledRef.current || !lines.length) return;
    let cancelled = false;
    void listFeituanOrdersForCustomer({
      customerKey,
      customerUserId: user?.uid,
    }).then((rows) => {
      if (cancelled || !rows.length) return;
      const prev = rows[0]!.data;
      contactPrefilledRef.current = true;
      setName(prev.customerName ?? '');
      setPhone(prev.customerPhone ?? '');
      setAddress(prev.customerAddress ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [customerKey, lines.length, user?.uid]);

  useEffect(() => {
    const line = address.trim();
    if (line.length < 2) return;
    if (points.length === 0) {
      setDeliveryId(OTHER_DELIVERY_ID);
      return;
    }
    const matched = suggestDeliveryPointsFromAddress(line, points);
    setDeliveryId(matched.length > 0 ? matched[0]!.id : OTHER_DELIVERY_ID);
  }, [address, points]);

  const total = useMemo(
    () => lines.reduce((s, x) => s + x.subtotal, 0),
    [lines]
  );

  const deliveryLabel = useMemo(() => {
    if (!deliveryId) return '';
    if (deliveryId === OTHER_DELIVERY_ID) return FEITUAN_MANUAL_DELIVERY_TITLE;
    const p = points.find((x) => x.id === deliveryId);
    if (!p) return '';
    return p.code?.trim() ? `${p.name}（${p.code.trim()}）` : p.name;
  }, [deliveryId, points]);

  const deliverySnapshot = useMemo(() => {
    if (!deliveryId || deliveryId === OTHER_DELIVERY_ID) {
      return { name: '', detail: undefined as string | undefined };
    }
    const p = points.find((x) => x.id === deliveryId);
    const detailParts = [p?.detailAddress, p?.deliveryTime].filter(Boolean);
    return {
      name: p?.name ?? '',
      detail: detailParts.length ? detailParts.join(' · ') : undefined,
    };
  }, [deliveryId, points]);

  const handleSubmit = async () => {
    setErr(null);
    setResultMsg(null);
    if (!name.trim() || !address.trim() || !deliveryId) {
      setErr('请填写姓名、地址并选择配送方式');
      return;
    }
    const isManualMatch = deliveryId === OTHER_DELIVERY_ID;
    const addrOut = address.trim();
    setSubmitting(true);
    const paymentRef = createFeituanPaymentRef();
    const batchSize = lines.length;
    const succeeded: string[] = [];
    const failed: { title: string; message: string }[] = [];

    for (const row of lines) {
      try {
        await createOrder({
          shopSlug: row.shopSlug,
          projectId: row.cart.projectId,
          channel: 'feituan',
          customerKey,
          customerUserId: user?.phoneNumber ? user.uid : undefined,
          customerPhoneMasked: user?.phoneNumber
            ? `****${user.phoneNumber.replace(/\D/g, '').slice(-4)}`
            : undefined,
          wechatNotifyOAuthStateId: getWechatNotifyOAuthStateId(),
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerAddress: addrOut,
          customerNote: note.trim() || undefined,
          deliveryPointId: isManualMatch ? undefined : deliveryId,
          deliveryPointLabel: isManualMatch
            ? `${FEITUAN_MANUAL_DELIVERY_TITLE} ${FEITUAN_MANUAL_DELIVERY_SUB} ${addrOut}`
            : deliveryLabel,
          deliverySnapshot:
            isManualMatch || !deliverySnapshot.name
              ? undefined
              : deliverySnapshot,
          isManualMatch,
          lines: row.lines,
          bundleSelections: row.bundleSelections,
          paymentRef,
          paymentBatchSize: batchSize,
        });
        succeeded.push(row.cart.projectId);
        removeFeituanCartProject(row.cart.projectId);
      } catch (e) {
        const message =
          e instanceof CreateOrderError
            ? e.message
            : e instanceof Error
              ? e.message
              : '下单失败';
        failed.push({ title: row.cart.projectTitle, message });
      }
    }

    notifyFeituanCartUpdated();
    setSubmitting(false);

    if (succeeded.length === 0) {
      setErr('全部下单失败，请返回购物车重试');
      return;
    }
    if (failed.length > 0) {
      setResultMsg(
        `已成功 ${succeeded.length} 个项目；${failed.length} 个失败：${failed.map((f) => f.title).join('、')}`
      );
    }
    if (succeeded.length === lines.length) {
      clearFeituanCart();
      notifyFeituanCartUpdated();
    }
    navigate(`/feituan/cart-payment/${encodeURIComponent(paymentRef)}`, {
      replace: true,
      state: { partialFail: failed },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-gray-600">
        加载结算信息…
      </div>
    );
  }

  return (
    <div className={`${FEITUAN_TW.flowPage} pb-28`}>
      <FeituanFlowHeader
        backTo="/feituan/cart"
        backLabel="购物车"
        title="合并结算"
        subtitle={`${lines.length} 个项目`}
      />

      <main className={FEITUAN_TW.flowMain}>
        {err ? <p className="text-red-600">{err}</p> : null}
        {resultMsg ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{resultMsg}</p>
        ) : null}

        <section className={`rounded-xl border p-3 ${FEITUAN_TW.panelHeader}`}>
          <h2 className={`mb-2 text-sm font-semibold ${FEITUAN_TW.text}`}>订单预览</h2>
          <ul className="space-y-3">
            {lines.map((row) => (
              <li key={row.cart.projectId} className="border-b border-gray-50 pb-2 last:border-0">
                <p className="font-medium">{row.cart.projectTitle}</p>
                {row.recurringHint ? (
                  <p className="text-xs text-emerald-800">预计：{row.recurringHint}</p>
                ) : null}
                <p className="mt-1 text-right font-semibold tabular-nums">
                  {formatMYR(row.subtotal)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right text-base font-bold tabular-nums">
            合计 {formatMYR(total)}
          </p>
        </section>

        <section className={FEITUAN_TW.formSection}>
          <h2 className={`mb-2 text-sm font-semibold ${FEITUAN_TW.text}`}>
            联系与配送
          </h2>
          <FeituanContactFields
            name={name}
            phone={phone}
            address={address}
            note={note}
            onNameChange={setName}
            onPhoneChange={setPhone}
            onAddressChange={setAddress}
            onNoteChange={setNote}
          >
            <div className="pt-1">
              <p className={`mb-1.5 ${FEITUAN_TW.fieldLabel}`}>配送点</p>
              <div className="space-y-1.5">
            {points.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                  deliveryId === p.id
                    ? FEITUAN_TW.selectedSoft
                    : 'border-[#D8F0E4] bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="dp"
                  checked={deliveryId === p.id}
                  onChange={() => setDeliveryId(p.id)}
                  className="text-[#0F8F5F]"
                />
                <span className="text-sm text-[#0F8F5F]">{p.name}</span>
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                deliveryId === OTHER_DELIVERY_ID
                  ? FEITUAN_TW.selectedSoft
                  : 'border-[#D8F0E4] bg-white'
              }`}
            >
              <input
                type="radio"
                name="dp"
                checked={deliveryId === OTHER_DELIVERY_ID}
                onChange={() => setDeliveryId(OTHER_DELIVERY_ID)}
                className="text-[#0F8F5F]"
              />
              <span className="text-sm text-[#0F8F5F]">
                未指定配送点（按地址联系）
              </span>
            </label>
              </div>
            </div>
          </FeituanContactFields>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-[#D8F0E4] bg-white p-4 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={submitting || lines.length === 0}
          className={`mx-auto flex h-11 w-full max-w-xl items-center justify-center rounded-xl text-sm font-semibold disabled:bg-gray-300 ${FEITUAN_TW.btn}`}
          onClick={() => void handleSubmit()}
        >
          {submitting ? '提交中…' : `提交 ${lines.length} 个项目并付款`}
        </button>
      </div>
    </div>
  );
}
