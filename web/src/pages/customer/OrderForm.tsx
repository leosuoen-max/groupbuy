import { useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { OTHER_DELIVERY_ID } from '../../data/mockDeliveryPoints';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { listDeliveryPointsByShopId } from '../../lib/deliveryPointService';
import { createOrder, CreateOrderError, listOrdersByCustomer } from '../../lib/orderService';
import { suggestDeliveryPointFromAddress } from '../../lib/deliveryPointMatch';
import { getProject } from '../../lib/projectService';
import { getShopBySlug } from '../../lib/shopService';
import type { CartLocationState, MockDeliveryPoint, OrderLine } from '../../types/orderDraft';
import type { ProjectDoc } from '../../types/firestore';

type Step = 1 | 2 | 3;

function projectAllowsCustomerOrder(project: ProjectDoc): boolean {
  if (project.status === 'draft') return false;
  if (project.status === 'closed') return false;
  const closes = project.closesAt?.toDate?.();
  if (closes && closes.getTime() <= Date.now()) return false;
  return true;
}

export default function OrderForm() {
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state ?? {}) as CartLocationState;
  const lines = (incoming.lines ?? []).filter(Boolean);
  const projectTitleState = incoming.projectTitle ?? '当前项目';

  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [deliveryId, setDeliveryId] = useState<string>('');
  /** 用户对当前推测配送点点「否」后记录该配送点 id；推测变化时需重新确认 */
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<
    string | null
  >(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitHint, setSubmitHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [points, setPoints] = useState<MockDeliveryPoint[]>([]);
  const contactPrefilledRef = useRef(false);
  const [didPrefillFromLastOrder, setDidPrefillFromLastOrder] = useState(false);

  useEffect(() => {
    contactPrefilledRef.current = false;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        setBooting(true);
        setBootErr(null);
        try {
          const shopRow = await getShopBySlug(decodeURIComponent(shopSlug));
          if (!shopRow) {
            if (!cancelled) setBootErr('店铺不存在或链接有误。');
            return;
          }
          const projectRow = await getProject(decodeURIComponent(projectId));
          if (!projectRow) {
            if (!cancelled) setBootErr('项目不存在或已删除。');
            return;
          }
          if (projectRow.data.shopId !== shopRow.id) {
            if (!cancelled) setBootErr('项目与店铺不匹配。');
            return;
          }

          const allPoints = await listDeliveryPointsByShopId(shopRow.id);
          const allowed = new Set(projectRow.data.deliveryPointIds ?? []);
          const filtered =
            allowed.size > 0
              ? allPoints.filter((p) => allowed.has(p.id))
              : allPoints;

          const uiPoints: MockDeliveryPoint[] = filtered.map((p) => ({
            id: p.id,
            name: p.data.name,
            detailAddress: p.data.detailAddress,
            deliveryTime: p.data.deliveryTime,
            imageUrl: p.data.imageUrl,
          }));

          if (!cancelled) {
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
  }, [projectId, shopSlug]);

  /** 第二次及以后下单：姓名/电话；配送点与地址在第二步按上一笔订单预填（可改；备注不预填） */
  useEffect(() => {
    if (!project || booting || bootErr || contactPrefilledRef.current) return;
    const pid = decodeURIComponent(projectId);
    let cancelled = false;
    void listOrdersByCustomer(pid, getOrCreateCustomerKey())
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
        contactPrefilledRef.current = true;
        const d = prev.data;
        setDidPrefillFromLastOrder(true);
        setName((n) => (n.trim() !== '' ? n : d.customerName?.trim() ?? ''));
        setPhone((p) => (p.trim() !== '' ? p : d.customerPhone?.trim() ?? ''));

        const addr = d.customerAddress?.trim() ?? '';
        const pointOk =
          Boolean(d.deliveryPointId) &&
          !d.isManualMatch &&
          points.some((p) => p.id === d.deliveryPointId);

        if (pointOk && d.deliveryPointId) {
          setDeliveryId(d.deliveryPointId);
          setAddress((a) => (a.trim() !== '' ? a : addr));
        } else {
          setDeliveryId(OTHER_DELIVERY_ID);
          setAddress((a) => (a.trim() !== '' ? a : addr));
        }
        setDismissedSuggestionId(null);
      })
      .catch(() => {
        /* 静默失败，仍可手动填写 */
      });
    return () => {
      cancelled = true;
    };
  }, [project, booting, bootErr, projectId, points]);

  const resolvedProjectTitle = project?.title?.trim() || projectTitleState;
  const canPlaceOrder = project ? projectAllowsCustomerOrder(project) : false;

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    [lines]
  );

  const deliveryLabel = useMemo(() => {
    if (!deliveryId) return '';
    if (deliveryId === OTHER_DELIVERY_ID) return '以上都不对（其他）';
    return points.find((p) => p.id === deliveryId)?.name ?? '';
  }, [deliveryId, points]);

  const deliverySnapshot = useMemo(() => {
    if (!deliveryId || deliveryId === OTHER_DELIVERY_ID) return { name: '', detail: undefined as string | undefined };
    const p = points.find((x) => x.id === deliveryId);
    const detailParts = [p?.detailAddress, p?.deliveryTime].filter(Boolean);
    return {
      name: p?.name ?? '',
      detail: detailParts.length ? detailParts.join(' · ') : undefined,
    };
  }, [deliveryId, points]);

  const suggestedPoint = useMemo(() => {
    if (deliveryId !== OTHER_DELIVERY_ID) return null;
    const line = address.trim();
    if (line.length < 2) return null;
    return suggestDeliveryPointFromAddress(line, points);
  }, [deliveryId, address, points]);

  const resolvedCustomerAddress = useMemo(() => {
    const line = address.trim();
    if (line) return line;
    if (deliveryId && deliveryId !== OTHER_DELIVERY_ID) {
      const p = points.find((x) => x.id === deliveryId);
      if (p) {
        const bits = [p.name, p.detailAddress].filter(Boolean);
        return bits.length ? `配送点：${bits.join(' · ')}` : `配送点：${p.name}`;
      }
    }
    return '';
  }, [address, deliveryId, points]);

  const canGoStep2 =
    canPlaceOrder && name.trim().length > 0 && phone.trim().length > 0;

  const otherNeedsResolve =
    deliveryId === OTHER_DELIVERY_ID &&
    suggestedPoint !== null &&
    dismissedSuggestionId !== suggestedPoint.id;

  const canGoStep3 =
    canPlaceOrder &&
    deliveryId.length > 0 &&
    (deliveryId === OTHER_DELIVERY_ID
      ? address.trim().length > 0 && !otherNeedsResolve
      : true);

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitHint(null);
    if (!canPlaceOrder || !canGoStep3 || submitting) return;
    const isManualMatch = deliveryId === OTHER_DELIVERY_ID;
    const addrOut = resolvedCustomerAddress;
    if (!addrOut.trim()) {
      setSubmitError('请填写或确认配送地址信息。');
      return;
    }
    const customerKey = getOrCreateCustomerKey();
    try {
      setSubmitting(true);
      const { orderNumber } = await createOrder({
        shopSlug,
        projectId,
        customerKey,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerAddress: addrOut,
        customerNote: note.trim() || undefined,
        deliveryPointId: isManualMatch ? undefined : deliveryId,
        deliveryPointLabel: isManualMatch
          ? `其他（将按地址手动匹配）：${addrOut}`
          : deliveryLabel,
        deliverySnapshot:
          isManualMatch || !deliverySnapshot.name
            ? undefined
            : { name: deliverySnapshot.name, detail: deliverySnapshot.detail },
        isManualMatch,
        lines,
      });
      setSubmitHint('提交成功，正在跳转订单详情…');
      await new Promise((resolve) => window.setTimeout(resolve, 280));
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

  if (lines.length === 0) {
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

  const inputCls =
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[16px] text-gray-900 outline-none ring-emerald-500/30 focus:border-emerald-500 focus:ring-2';

  const blockedHint = !canPlaceOrder ? (
    <p className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      当前项目不可下单（草稿 / 已截止 / 已过截止时间）。你仍可查看页面与订单记录。
    </p>
  ) : null;

  const activeStep: Step = canPlaceOrder ? step : 1;

  return (
    <PageShell
      title="填写订单"
      subtitle={`步骤 ${activeStep} / 3 · ${resolvedProjectTitle}`}
    >
      {blockedHint}

      <div className="mb-4 flex gap-2 text-xs text-gray-500">
        <span className={activeStep >= 1 ? 'font-semibold text-gray-900' : ''}>
          ① 信息
        </span>
        <span>→</span>
        <span className={activeStep >= 2 ? 'font-semibold text-gray-900' : ''}>
          ② 配送
        </span>
        <span>→</span>
        <span className={activeStep >= 3 ? 'font-semibold text-gray-900' : ''}>
          ③ 确认
        </span>
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

      {activeStep === 1 ? (
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
            <Link
              to={base}
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
            >
              返回选菜
            </Link>
            <button
              type="button"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-gray-300"
              disabled={!canGoStep2}
              onClick={() => setStep(2)}
            >
              下一步：配送
            </button>
          </div>
        </div>
      ) : null}

      {activeStep === 2 ? (
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
            {points.map((p) => (
              <div key={p.id} className="rounded-xl border border-gray-100 p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="delivery"
                    className="mt-1 h-4 w-4"
                    checked={deliveryId === p.id}
                    onChange={() => {
                      setDeliveryId(p.id);
                      setDismissedSuggestionId(null);
                    }}
                  />
                  <span className="min-w-0 flex-1 text-sm text-gray-900">
                    {p.name}
                  </span>
                </label>
                <div className="mt-2 pl-7">
                  <button
                    type="button"
                    className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                    onClick={() =>
                      setExpandedId((id) => (id === p.id ? null : p.id))
                    }
                  >
                    {expandedId === p.id ? '收起详情' : '查看详情'}
                  </button>
                  {expandedId === p.id ? (
                    <div className="mt-2 space-y-1 text-xs text-gray-600">
                      {p.detailAddress ? <p>地址：{p.detailAddress}</p> : null}
                      {p.deliveryTime ? <p>时间：{p.deliveryTime}</p> : null}
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="mt-1 max-h-32 w-full rounded-lg object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              <input
                type="radio"
                name="delivery"
                className="mt-1 h-4 w-4"
                checked={deliveryId === OTHER_DELIVERY_ID}
                onChange={() => {
                  setDeliveryId(OTHER_DELIVERY_ID);
                  setDismissedSuggestionId(null);
                }}
              />
              <span className="min-w-0 flex-1 text-sm text-gray-900">
                以上都不对（其他）
                <span className="mt-1 block text-xs text-amber-900">
                  填写你的详细地址；系统将尝试匹配配送点，也可选择按单独地址由商户配送。
                </span>
              </span>
            </label>
          </div>

          {deliveryId && deliveryId !== OTHER_DELIVERY_ID ? (
            <label className="block text-sm text-gray-700">
              补充地址 / 门牌（选填）
              <textarea
                className={`${inputCls} min-h-[88px] resize-y`}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="street-address"
                placeholder="如需送货上门请填写栋号、单元；若到配送点自取可留空。"
              />
            </label>
          ) : null}

          {deliveryId === OTHER_DELIVERY_ID ? (
            <div className="space-y-3">
              <label className="block text-sm text-gray-700">
                详细地址 <span className="text-red-600">*</span>
                <textarea
                  className={`${inputCls} min-h-[100px] resize-y`}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="street-address"
                  placeholder="楼栋、门牌、片区等，便于商户或骑手送达。"
                />
              </label>
              {suggestedPoint ? (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-3 py-3 text-sm text-indigo-950">
                  <p className="font-medium text-indigo-950">
                    根据你填的地址，系统推测你可能属于配送点「{suggestedPoint.name}」，是否使用该配送点？
                  </p>
                  {suggestedPoint.detailAddress ? (
                    <p className="mt-1 text-xs text-indigo-900/90">
                      参考：{suggestedPoint.detailAddress}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex h-10 flex-1 min-w-[8rem] items-center justify-center rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white"
                      onClick={() => {
                        setDeliveryId(suggestedPoint.id);
                        setDismissedSuggestionId(null);
                      }}
                    >
                      是，使用该配送点
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-10 flex-1 min-w-[8rem] items-center justify-center rounded-lg border border-indigo-200 bg-white px-3 text-sm font-medium text-indigo-900"
                      onClick={() =>
                        setDismissedSuggestionId(suggestedPoint.id)
                      }
                    >
                      否，按单独地址配送
                    </button>
                  </div>
                  {otherNeedsResolve ? (
                    <p className="mt-2 text-xs text-indigo-800">
                      请选择「是」或「否」后再进入下一步。
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
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-gray-300"
              disabled={!canGoStep3}
              onClick={() => setStep(3)}
            >
              下一步：确认
            </button>
          </div>
        </div>
      ) : null}

      {activeStep === 3 ? (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">确认并提交</h2>
          <div className="rounded-xl border border-gray-100 bg-white px-3 py-3 text-sm text-gray-800">
            <div className="font-medium text-gray-900">顾客信息</div>
            <p className="mt-1">姓名：{name.trim()}</p>
            <p>电话：{phone.trim()}</p>
            {note.trim() ? <p>备注：{note.trim()}</p> : <p>备注：（无）</p>}
            <div className="mt-3 font-medium text-gray-900">配送与地址</div>
            <p className="mt-1">方式：{deliveryLabel}</p>
            <p className="mt-1 break-words">
              地址与说明：
              {resolvedCustomerAddress || '（将根据所选配送点自动生成）'}
            </p>
          </div>
          <p className="text-xs text-gray-500">提交后会写入数据库，并进行库存校验。</p>
          {submitError ? (
            <p className="text-sm text-red-600">{submitError}</p>
          ) : null}
          {submitHint ? (
            <p className="text-sm text-emerald-700">{submitHint}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-11 min-w-[5rem] items-center justify-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-800"
              onClick={() => setStep(2)}
              disabled={submitting || !canPlaceOrder}
            >
              上一步
            </button>
            <button
              type="button"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-gray-300"
              onClick={handleSubmit}
              disabled={submitting || !canPlaceOrder}
            >
              {submitting ? '提交中…' : '提交订单'}
            </button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
