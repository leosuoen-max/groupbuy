import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import { getShopBySlug, type ShopRow } from '../../lib/shopService';
import {
  cancelCardPurchaseRequest,
  listCardRequestsByCustomer,
  listCardTemplatesByShop,
  listCustomerCardsByCustomer,
  type CardPurchaseRequestRow,
  type CardTemplateRow,
  type CustomerCardRow,
} from '../../lib/cardService';
import { formatMYR } from '../../lib/formatMYR';
import type { CustomerCardStatus } from '../../types/firestore';

function fmtTs(t: { toDate?: () => Date } | null | undefined): string {
  if (!t || typeof t.toDate !== 'function') return '';
  return t.toDate().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const cardStatusLabel: Record<CustomerCardStatus, string> = {
  pending: '待商户确认',
  active: '可用',
  used_up: '已用完',
  expired: '已过期',
  cancelled: '已取消',
};

const cardStatusColor: Record<CustomerCardStatus, string> = {
  pending: 'bg-amber-50 text-amber-800',
  active: 'bg-emerald-50 text-emerald-700',
  used_up: 'bg-slate-100 text-slate-500',
  expired: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function CustomerCards() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const [search] = useSearchParams();
  const fromProject = search.get('from') ?? '';
  const customerKey = useMemo(() => getOrCreateCustomerKey(), []);

  const [shop, setShop] = useState<ShopRow | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<CardTemplateRow[]>([]);
  const [myCards, setMyCards] = useState<CustomerCardRow[]>([]);
  const [requests, setRequests] = useState<CardPurchaseRequestRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async (sid: string) => {
    const [tpls, cards, reqs] = await Promise.all([
      listCardTemplatesByShop(sid),
      listCustomerCardsByCustomer(customerKey, sid),
      listCardRequestsByCustomer(customerKey, sid),
    ]);
    setTemplates(tpls);
    setMyCards(cards);
    setRequests(reqs);
  }, [customerKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await getShopBySlug(slug);
        if (!row) throw new Error('店铺不存在');
        if (cancelled) return;
        setShop(row);
        await refresh(row.id);
      } catch (e) {
        if (!cancelled) setBootErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, refresh]);

  const handleCancelRequest = async (id: string) => {
    if (!shop) return;
    if (!confirm('确认撤销这笔购卡请求？已上传的截图也会一并失效。')) return;
    try {
      await cancelCardPurchaseRequest(id, customerKey);
      setMsg('已撤销');
      await refresh(shop.id);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '撤销失败');
    }
  };

  const backHref = useMemo(() => {
    if (fromProject) {
      return `/shop/${encodeURIComponent(slug)}/${encodeURIComponent(fromProject)}`;
    }
    return '/';
  }, [slug, fromProject]);

  if (loading) {
    return (
      <PageShell title="优惠卡" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }
  if (bootErr || !shop) {
    return (
      <PageShell title="优惠卡" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr ?? '店铺不存在'}</p>
      </PageShell>
    );
  }

  const buyHrefBase = `/shop/${encodeURIComponent(slug)}/cards/buy`;
  const topupHrefBase = `/shop/${encodeURIComponent(slug)}/cards/topup`;
  const queryFrom = fromProject ? `?from=${encodeURIComponent(fromProject)}` : '';

  const pendingRequests = requests.filter((r) => r.data.status === 'pending');

  return (
    <PageShell title="优惠卡" subtitle={shop.data.name}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <p className="mb-3 text-sm">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to={backHref}>
          ← 返回
        </Link>
      </p>

      {/* 我的卡片 */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">我的卡片</h2>
        {myCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-5 text-center text-xs text-gray-500">
            还没有任何卡，下方可购买。
          </p>
        ) : (
          <div className="space-y-2">
            {myCards.map((c) => {
              const isStored = c.data.type === 'stored';
              const remainText = isStored
                ? `余额 RM ${Number(c.data.remaining ?? 0).toFixed(2)}`
                : `剩余 ${Number(c.data.remaining ?? 0)} 次`;
              const validText = c.data.validUntil
                ? `有效期至 ${fmtTs(c.data.validUntil)}`
                : '永久有效';
              const isActive = c.data.status === 'active';
              return (
                <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-gray-900">
                          {c.data.templateNameSnapshot}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                            isStored
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-purple-50 text-purple-700'
                          }`}
                        >
                          {isStored ? '钱包' : '次卡'}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${cardStatusColor[c.data.status]}`}
                        >
                          {cardStatusLabel[c.data.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">{remainText}</p>
                      <p className="text-xs text-gray-500">{validText}</p>
                    </div>
                    {isActive ? (
                      <Link
                        to={`${topupHrefBase}/${encodeURIComponent(c.id)}${queryFrom}`}
                        className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700"
                      >
                        充值
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 待确认的购卡 / 充值 */}
      {pendingRequests.length > 0 ? (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">待商户确认</h2>
          <div className="space-y-2">
            {pendingRequests.map((r) => {
              const isStored = r.data.templateTypeSnapshot === 'stored';
              const gainText = isStored
                ? `面值 RM ${Number(r.data.gainValue).toFixed(2)}`
                : `${Number(r.data.gainValue)} 次`;
              return (
                <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 text-xs text-amber-900">
                      <div className="font-semibold">
                        {r.data.kind === 'topup' ? '充值' : '购买'}：
                        {r.data.templateNameSnapshot}
                      </div>
                      <div>
                        到账 {gainText} · 实付 RM{' '}
                        {Number(r.data.payAmount).toFixed(2)}
                      </div>
                      <div className="text-amber-800">
                        {r.data.paymentScreenshots?.length ?? 0} 张截图
                        ·提交于 {fmtTs(r.data.createdAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700"
                      onClick={() => void handleCancelRequest(r.id)}
                    >
                      撤销
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 可购买的卡 */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">可购买的卡</h2>
        {templates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-5 text-center text-xs text-gray-500">
            店铺暂未上架优惠卡。
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => {
              const isStored = t.data.type === 'stored';
              const valueText = isStored
                ? `面值 RM ${Number(t.data.faceValueOrUses ?? 0).toFixed(2)}`
                : `${Number(t.data.faceValueOrUses ?? 0)} 次`;
              const validity =
                Number(t.data.validityDays ?? 0) > 0
                  ? `${t.data.validityDays} 天有效`
                  : '永久有效';
              const myActiveWallet = isStored
                ? myCards.find(
                    (c) =>
                      c.data.templateId === t.id && c.data.status === 'active'
                  )
                : null;
              const myPendingPurchase = isStored
                ? requests.find(
                    (r) =>
                      r.data.templateId === t.id &&
                      r.data.kind === 'purchase' &&
                      r.data.status === 'pending'
                  )
                : null;
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-gray-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-gray-900">
                          {t.data.name}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                            isStored
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-purple-50 text-purple-700'
                          }`}
                        >
                          {isStored ? '钱包' : '次卡'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-700">
                        {valueText} · 售价{' '}
                        <span className="text-base font-bold text-gray-900">
                          {formatMYR(Number(t.data.salePrice ?? 0))}
                        </span>
                        ·{validity}
                      </p>
                      {t.data.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                          {t.data.description}
                        </p>
                      ) : null}
                    </div>
                    {myActiveWallet ? (
                      <Link
                        to={`${topupHrefBase}/${encodeURIComponent(myActiveWallet.id)}${queryFrom}`}
                        className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700"
                      >
                        去充值
                      </Link>
                    ) : myPendingPurchase ? (
                      <span className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                        待确认
                      </span>
                    ) : (
                      <Link
                        to={`${buyHrefBase}/${encodeURIComponent(t.id)}${queryFrom}`}
                        className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        购买
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        小提示：卡与本设备绑定（用于免登录识别）。换设备或清缓存可能看不到自己的卡，请尽量在同一设备使用。
      </p>
    </PageShell>
  );
}
