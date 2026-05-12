import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { getShopBySlug, isShopOpenForCustomers, type ShopRow } from '../../lib/shopService';
import {
  appendCardPaymentScreenshotToRequest,
  cancelCardPurchaseRequest,
  getCardPurchaseRequest,
  getCardTemplate,
  getCustomerCard,
  listCardRequestsByCustomer,
  listCustomerCardsByCustomer,
  removeCardPaymentScreenshotFromRequest,
  submitCardPurchaseRequest,
  uploadCardPaymentImage,
  type CardPurchaseRequestRow,
  type CardTemplateRow,
  type CustomerCardRow,
} from '../../lib/cardService';
import { sha256HexOfFile } from '../../lib/fileSha256';
import { compressImageFileForUpload } from '../../lib/imageCompress';
import { formatMYR } from '../../lib/formatMYR';
import { withTimeout } from '../../lib/withTimeout';
import type {
  CardTopupRule,
  CardType,
} from '../../types/firestore';

type Mode = 'purchase' | 'topup';

type CardBuyProps = {
  mode: Mode;
};

const inputCls =
  'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

/** 与下单页一致：弱网下 Firestore 久无返回时用超时提示，避免一直停在「加载中」 */
const LOAD_TIMEOUT_MS = 12_000;

export default function CustomerCardBuy({ mode }: CardBuyProps) {
  const params = useParams<{ shopSlug: string; templateId?: string; cardId?: string }>();
  const slug = decodeURIComponent(params.shopSlug ?? '');
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const fromProject = search.get('from') ?? '';
  /** 从「我的卡片」返回继续上传凭证时携带，与 pending 请求 id 一致则进入付款页而非拦截 */
  const resumeRequestId = search.get('resumeRequest')?.trim() ?? '';
  const customerKey = useMemo(() => getOrCreateCustomerKey(), []);

  const [shop, setShop] = useState<ShopRow | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [template, setTemplate] = useState<CardTemplateRow | null>(null);
  const [existingCard, setExistingCard] = useState<CustomerCardRow | null>(null);
  const [walletBlock, setWalletBlock] = useState<
    | { kind: 'has_active'; cardId: string }
    | { kind: 'has_pending'; requestId: string }
    | null
  >(null);
  const [passBlock, setPassBlock] = useState<
    | { kind: 'has_card'; cardId: string }
    | { kind: 'has_pending'; requestId: string }
    | null
  >(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedRuleIdx, setSelectedRuleIdx] = useState<number>(-1);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [request, setRequest] = useState<CardPurchaseRequestRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [qrPreview, setQrPreview] = useState<{ name: string; url: string } | null>(null);

  const refreshRequest = useCallback(async () => {
    if (!requestId) return;
    const r = await getCardPurchaseRequest(requestId);
    setRequest(r);
  }, [requestId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (mode === 'purchase') {
          if (!params.templateId) throw new Error('缺少卡模板参数');
          const [row, t] = await Promise.all([
            withTimeout(getShopBySlug(slug), LOAD_TIMEOUT_MS, '店铺加载'),
            withTimeout(
              getCardTemplate(params.templateId),
              LOAD_TIMEOUT_MS,
              '卡模板加载'
            ),
          ]);
          if (!row) throw new Error('店铺不存在');
          if (!isShopOpenForCustomers(row.data)) throw new Error('该店铺已停用');
          if (!t) throw new Error('卡模板不存在');
          if (t.data.shopId !== row.id) throw new Error('卡与店铺不匹配');
          if (cancelled) return;
          setShop(row);
          if (!cancelled) setTemplate(t);

          // 钱包：一人一钱包，若已持有 active 或已存在 pending 请求，引导跳转
          if (t.data.type === 'stored') {
            const [cards, reqs] = await withTimeout(
              Promise.all([
                listCustomerCardsByCustomer(customerKey, row.id),
                listCardRequestsByCustomer(customerKey, row.id, {
                  status: 'pending',
                }),
              ]),
              LOAD_TIMEOUT_MS,
              '购卡资格校验'
            );
            const activeWallet = cards.find(
              (c) => c.data.templateId === t.id && c.data.status === 'active'
            );
            const pendingPurchase = reqs.find(
              (r) =>
                r.data.templateId === t.id && r.data.kind === 'purchase'
            );
            if (cancelled) return;
            if (activeWallet) {
              setWalletBlock({ kind: 'has_active', cardId: activeWallet.id });
            } else if (pendingPurchase) {
              if (resumeRequestId && resumeRequestId === pendingPurchase.id) {
                setRequestId(pendingPurchase.id);
                setRequest(pendingPurchase);
              } else {
                setWalletBlock({
                  kind: 'has_pending',
                  requestId: pendingPurchase.id,
                });
              }
            }
          } else if (t.data.type === 'pass') {
            const [cards, reqs] = await withTimeout(
              Promise.all([
                listCustomerCardsByCustomer(customerKey, row.id),
                listCardRequestsByCustomer(customerKey, row.id, {
                  status: 'pending',
                }),
              ]),
              LOAD_TIMEOUT_MS,
              '购卡资格校验'
            );
            const pendingPur = reqs.find(
              (r) =>
                r.data.templateId === t.id && r.data.kind === 'purchase'
            );
            const owned = cards.filter(
              (c) =>
                c.data.templateId === t.id &&
                c.data.status !== 'cancelled'
            );
            const rechargeable = owned.find(
              (c) =>
                c.data.status === 'active' || c.data.status === 'used_up'
            );
            if (cancelled) return;
            if (pendingPur) {
              if (resumeRequestId && resumeRequestId === pendingPur.id) {
                setRequestId(pendingPur.id);
                setRequest(pendingPur);
              } else {
                setPassBlock({
                  kind: 'has_pending',
                  requestId: pendingPur.id,
                });
              }
            } else if (owned.length > 0) {
              const targetId = rechargeable?.id ?? owned[0]!.id;
              setPassBlock({ kind: 'has_card', cardId: targetId });
            }
          }
        } else {
          if (!params.cardId) throw new Error('缺少卡实例参数');
          const [row, c] = await Promise.all([
            withTimeout(getShopBySlug(slug), LOAD_TIMEOUT_MS, '店铺加载'),
            withTimeout(
              getCustomerCard(params.cardId),
              LOAD_TIMEOUT_MS,
              '卡片加载'
            ),
          ]);
          if (!row) throw new Error('店铺不存在');
          if (!isShopOpenForCustomers(row.data)) throw new Error('该店铺已停用');
          if (!c) throw new Error('卡不存在');
          if (c.data.customerKey !== customerKey) throw new Error('无权操作他人卡');
          if (c.data.shopId !== row.id) throw new Error('卡与店铺不匹配');
          if (cancelled) return;
          setShop(row);
          if (!cancelled) setExistingCard(c);
          const t = await withTimeout(
            getCardTemplate(c.data.templateId),
            LOAD_TIMEOUT_MS,
            '卡模板加载'
          );
          if (!t) throw new Error('对应卡模板不存在');
          if (!cancelled) setTemplate(t);
          if (resumeRequestId) {
            const reqs = await withTimeout(
              listCardRequestsByCustomer(customerKey, row.id, {
                status: 'pending',
              }),
              LOAD_TIMEOUT_MS,
              '充值记录加载'
            );
            const pendingTopup = reqs.find(
              (r) =>
                r.id === resumeRequestId &&
                r.data.kind === 'topup' &&
                r.data.customerCardId === params.cardId
            );
            if (!cancelled && pendingTopup) {
              setRequestId(pendingTopup.id);
              setRequest(pendingTopup);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setBootErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, mode, params.templateId, params.cardId, customerKey, resumeRequestId]);

  // 计算"应付 / 到账"
  const tplData = template?.data;
  const tplType: CardType | undefined = tplData?.type;
  const isStored = tplType === 'stored';

  const offers = useMemo(() => {
    if (!tplData) return [] as { idx: number; pay: number; gain: number; label: string }[];
    if (mode === 'purchase') {
      return [
        {
          idx: -1,
          pay: Number(tplData.salePrice) || 0,
          gain: Number(tplData.faceValueOrUses) || 0,
          label: '首购专享（仅首次购买）',
        },
      ];
    }
    const rules: CardTopupRule[] = Array.isArray(tplData.topupRules)
      ? tplData.topupRules
      : [];
    return rules.map((r, i) => ({
      idx: i,
      pay: Number(r.pay) || 0,
      gain: Number(r.gain) || 0,
      label: `充值档位 ${i + 1}`,
    }));
  }, [tplData, mode]);

  useEffect(() => {
    if (requestId || offers.length === 0) return;
    setSelectedRuleIdx((prev) => {
      const stillValid = offers.some((o) => o.idx === prev);
      if (stillValid) return prev;
      return offers[0]!.idx;
    });
  }, [offers, requestId]);

  const selected = useMemo(() => {
    return offers.find((o) => o.idx === selectedRuleIdx) ?? null;
  }, [offers, selectedRuleIdx]);

  // 提交请求
  const handleSubmit = async () => {
    if (!shop || !template) return;
    if (!selected) {
      setMsg('请选择购买/充值方式');
      return;
    }
    if (mode === 'purchase' && !name.trim()) {
      setMsg('请填写姓名（用于商户对账）');
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const rid = await submitCardPurchaseRequest({
        shopId: shop.id,
        templateId: template.id,
        kind: mode,
        customerCardId: existingCard?.id,
        customerKey,
        customerName: mode === 'purchase' ? name.trim() : undefined,
        customerPhone: mode === 'purchase' ? phone.trim() : undefined,
        payAmount: selected.pay,
        gainValue: selected.gain,
      });
      setRequestId(rid);
      const r = await getCardPurchaseRequest(rid);
      setRequest(r);
      setMsg('已生成请求，请上传付款截图');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !shop || !requestId) return;
    setUploading(true);
    setMsg(null);
    try {
      const toSend = await compressImageFileForUpload(file);
      const hex = await sha256HexOfFile(toSend);
      const url = await uploadCardPaymentImage({
        shopId: shop.id,
        requestId,
        file: toSend,
      });
      await appendCardPaymentScreenshotToRequest(requestId, url, {
        contentSha256: hex,
      });
      await refreshRequest();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (url: string) => {
    if (!requestId) return;
    if (!confirm('删除该截图？')) return;
    try {
      await removeCardPaymentScreenshotFromRequest(requestId, url);
      await refreshRequest();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleCancel = async () => {
    if (!requestId) return;
    if (!confirm('确认撤销本笔购卡请求？')) return;
    try {
      await cancelCardPurchaseRequest(requestId, customerKey);
      setMsg('已撤销，将返回卡片首页');
      const back = `/shop/${encodeURIComponent(slug)}/cards${
        fromProject ? `?from=${encodeURIComponent(fromProject)}` : ''
      }`;
      navigate(back);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '撤销失败');
    }
  };

  const cardsHref = `/shop/${encodeURIComponent(slug)}/cards${
    fromProject ? `?from=${encodeURIComponent(fromProject)}` : ''
  }`;

  const shopPaymentMethods = useMemo(
    () =>
      (shop?.data.paymentMethods ?? []).filter(
        (pm) => pm?.qrCodeUrl && String(pm.qrCodeUrl).trim().length > 0
      ),
    [shop?.data.paymentMethods]
  );
  const primaryPaymentMethod = shopPaymentMethods[0] ?? null;
  const extraPaymentMethods = shopPaymentMethods.slice(1);

  if (loading) {
    return (
      <PageShell title={mode === 'purchase' ? '购买优惠卡' : '充值'} subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">
          网络较慢时可能需要十余秒。若一直停留在此页，请检查网络或下拉刷新；多次失败可稍后再试。
        </p>
      </PageShell>
    );
  }
  if (bootErr || !shop || !template) {
    return (
      <PageShell title={mode === 'purchase' ? '购买优惠卡' : '充值'} subtitle="错误">
        <p className="text-sm text-red-600">{bootErr ?? '加载失败'}</p>
        <Link className="mt-3 inline-block text-indigo-600" to={cardsHref}>
          返回
        </Link>
      </PageShell>
    );
  }

  const valueLabel = isStored
    ? `面值 RM ${Number(tplData?.faceValueOrUses ?? 0).toFixed(2)}`
    : `${Number(tplData?.faceValueOrUses ?? 0)} 次`;

  return (
    <PageShell
      title={mode === 'purchase' ? '购买优惠卡' : '充值'}
      subtitle={`${shop.data.name} · ${template.data.name}`}
    >
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <p className="mb-3 text-sm">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to={cardsHref}>
          ← 返回卡片首页
        </Link>
      </p>

      {/* 卡概览 */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-semibold text-gray-900">{template.data.name}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
              isStored ? 'bg-indigo-50 text-indigo-700' : 'bg-purple-50 text-purple-700'
            }`}
          >
            {isStored ? '钱包' : '次卡'}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-700">
          {mode === 'topup' ? (
            <>
              充值仅适用下方「充值档位」，不包含首购专享价。
              {Number(template.data.validityDays ?? 0) > 0
                ? ` · ${template.data.validityDays} 天有效`
                : ' · 永久有效'}
            </>
          ) : (
            <>
              {valueLabel} · 首购实付{' '}
              <span className="font-bold text-gray-900">
                RM {Number(template.data.salePrice ?? 0).toFixed(2)}
              </span>{' '}
              ·{' '}
              {Number(template.data.validityDays ?? 0) > 0
                ? `${template.data.validityDays} 天有效`
                : '永久有效'}
            </>
          )}
        </p>
        {existingCard ? (
          <p className="mt-1 text-xs text-gray-600">
            当前卡余额：
            {isStored
              ? `RM ${Number(existingCard.data.remaining ?? 0).toFixed(2)}`
              : `${Number(existingCard.data.remaining ?? 0)} 次`}
          </p>
        ) : null}
        {template.data.description ? (
          <p className="mt-1 whitespace-pre-line text-xs text-gray-500">
            {template.data.description}
          </p>
        ) : null}
      </section>

      {/* 选择档位 / 钱包拦截 */}
      {!request ? (
        walletBlock ? (
          <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {walletBlock.kind === 'has_active' ? (
              <>
                <p className="font-semibold">你已经持有这个钱包了</p>
                <p className="mt-1 text-xs">
                  钱包是同一店铺、同一类型仅一份，要加余额请直接「充值」即可。
                </p>
                <Link
                  to={cardsHref}
                  className="mt-3 inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  返回卡片首页 → 选择「去充值」
                </Link>
              </>
            ) : (
              <>
                <p className="font-semibold">你还有一笔进行中的钱包开通</p>
                <p className="mt-1 text-xs">
                  若尚未上传付款截图，请在卡片首页进入「待上传付款凭证」继续上传；若已上传，请等待商户确认。也可在首页撤销后重新发起。
                </p>
                <Link
                  to={cardsHref}
                  className="mt-3 inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  返回卡片首页
                </Link>
              </>
            )}
          </section>
        ) : passBlock ? (
          <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {passBlock.kind === 'has_pending' ? (
              <>
                <p className="font-semibold">你还有一笔进行中的次卡首购</p>
                <p className="mt-1 text-xs">
                  若尚未上传付款截图，请在卡片首页「待上传付款凭证」继续上传；若已上传则等待商户确认。首购价仅首笔可享受；也可撤销后重新发起。
                </p>
                <Link
                  to={cardsHref}
                  className="mt-3 inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  返回卡片首页
                </Link>
              </>
            ) : (
              <>
                <p className="font-semibold">你已持有该次卡</p>
                <p className="mt-1 text-xs">
                  同一模板不可重复首购；续次数请按商户配置的「充值档位」充值。
                </p>
                <Link
                  to={`/shop/${encodeURIComponent(slug)}/cards/topup/${encodeURIComponent(passBlock.cardId)}${fromProject ? `?from=${encodeURIComponent(fromProject)}` : ''}`}
                  className="mt-3 inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  前往充值
                </Link>
              </>
            )}
          </section>
        ) : (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            {mode === 'purchase' ? '首购确认' : '充值档位'}
          </h2>
          {offers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-3 py-5 text-center text-xs text-amber-900">
              {mode === 'topup'
                ? '商户尚未配置充值档位，暂时无法在线充值，请联系店家。'
                : '暂无可选方案。'}
            </p>
          ) : (
            <div className="space-y-2">
              {offers.map((o) => (
                <button
                  type="button"
                  key={`${o.idx}`}
                  onClick={() => setSelectedRuleIdx(o.idx)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
                    selectedRuleIdx === o.idx
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900">{o.label}</div>
                    <div className="text-xs text-gray-600">
                      实付 {formatMYR(o.pay)} → 到账{' '}
                      {isStored ? `RM ${o.gain.toFixed(2)} 面值` : `${o.gain} 次`}
                    </div>
                  </div>
                  <span className="text-base font-bold text-emerald-700">
                    {formatMYR(o.pay)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {mode === 'purchase' ? (
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-gray-800">
                姓名（用于商户对账）
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-gray-800">
                电话（可选）
                <input
                  className={inputCls}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:bg-gray-300"
            onClick={() => void handleSubmit()}
            disabled={submitting || offers.length === 0}
          >
            {submitting ? '提交中…' : '生成请求并去上传截图'}
          </button>
        </section>
        )
      ) : (
        <section className="mb-4 space-y-3">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold text-indigo-900">
              支付方法二：转账、上传付款截图
            </h2>
            <div className="mb-3 rounded-lg bg-white px-3 py-2 text-xs text-indigo-900 ring-1 ring-indigo-100">
              <p>
                应付合计：
                <strong className="ml-1 text-base font-bold tabular-nums text-gray-900">
                  {formatMYR(Number(request.data.payAmount))}
                </strong>
              </p>
              <p className="mt-0.5">
                到账：{' '}
                {request.data.templateTypeSnapshot === 'stored'
                  ? `面值 RM ${Number(request.data.gainValue).toFixed(2)}`
                  : `${Number(request.data.gainValue)} 次`}
              </p>
            </div>

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
                  <div className="flex aspect-square w-[6.5rem] items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-white text-center text-[11px] leading-snug text-indigo-500">
                    暂无收款码
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="mb-2 text-xs leading-relaxed text-indigo-900/80">
                  请按「应付合计」转账。可一笔付清或分多笔支付，到账总额与本笔实付一致即可。
                </p>
                {request.data.status === 'pending' ? (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {uploading ? '上传中…' : '选择图片上传'}
                  </button>
                ) : (
                  <div className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-indigo-100 bg-white px-2 text-xs text-gray-500">
                    当前不可上传
                  </div>
                )}
                <p
                  className="mt-1 line-clamp-3 text-[11px] text-indigo-900/70"
                  title="请按「应付合计」转账。你可「一笔付清」或「分多笔支付」，只要到账总额与本笔实付一致即可；上传至少一张截图供商户核对。商户确认后卡内余额/次数生效。"
                >
                  请按「应付合计」转账。你可「一笔付清」或「分多笔支付」，只要到账总额与本笔实付一致即可；上传至少一张截图供商户核对。商户确认后卡内余额/次数生效。
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
                ) : primaryPaymentMethod ? (
                  <span className="text-[11px] text-indigo-900/70">点击收款码可放大 / 下载</span>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] text-amber-700">没有付款凭证，无法开通。</span>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading || request.data.status !== 'pending'}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void handleUpload(f);
              e.currentTarget.value = '';
            }}
          />

          {Array.isArray(request.data.paymentScreenshots) &&
          request.data.paymentScreenshots.length > 0 ? (
            <ul className="space-y-2">
              {request.data.paymentScreenshots.map((s) => (
                <li
                  key={s.url}
                  className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2"
                >
                  <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={s.url} alt="" className="h-16 w-16 rounded-md object-cover" />
                  </a>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-medium text-gray-900">已上传截图</p>
                    {s.uploadedAt ? (
                      <p className="mt-1 text-gray-500">
                        {s.uploadedAt.toDate?.().toLocaleString?.() ?? ''}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 underline-offset-2 hover:underline"
                      >
                        查看原图
                      </a>
                      {request.data.status === 'pending' ? (
                        <button
                          type="button"
                          disabled={uploading}
                          onClick={() => void handleRemove(s.url)}
                          className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">尚未上传截图。</p>
          )}

          <div className="flex gap-2">
            <Link
              to={cardsHref}
              className="flex-1 rounded-lg border border-gray-200 bg-white py-2.5 text-center text-sm font-medium text-gray-700"
            >
              先去其他页
            </Link>
            <button
              type="button"
              className="flex-1 rounded-lg border border-red-200 bg-white py-2.5 text-sm font-medium text-red-700"
              onClick={() => void handleCancel()}
            >
              撤销请求
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            提交后请耐心等待商户确认，到账即可使用。可在「我的卡片」查看状态。
          </p>
        </section>
      )}

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
