import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { getShopBySlug } from '../../lib/shopService';
import {
  confirmCardPurchaseRequest,
  getCardTemplate,
  listCardLedger,
  listCardRequestsByTemplate,
  listCustomerCardsByTemplate,
  rejectCardPurchaseRequest,
  type CardLedgerRow,
  type CardPurchaseRequestRow,
  type CardTemplateRow,
  type CustomerCardRow,
} from '../../lib/cardService';
import { formatMYR } from '../../lib/formatMYR';
import type { CardLedgerType, CustomerCardStatus } from '../../types/firestore';

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

const ledgerLabel: Record<CardLedgerType, string> = {
  purchase: '购卡',
  topup: '充值',
  use: '使用',
  refund: '退款',
  expire: '过期',
};

const ledgerColor: Record<CardLedgerType, string> = {
  purchase: 'text-emerald-700',
  topup: 'text-emerald-700',
  use: 'text-rose-700',
  refund: 'text-amber-700',
  expire: 'text-slate-500',
};

const cardStatusLabel: Record<CustomerCardStatus, string> = {
  pending: '待确认',
  active: '可用',
  used_up: '已用完',
  expired: '已过期',
  cancelled: '已取消',
};

export default function CardTemplateDetail() {
  const { shopSlug = '', templateId = '' } = useParams<{
    shopSlug: string;
    templateId: string;
  }>();
  const slug = decodeURIComponent(shopSlug);
  const tid = decodeURIComponent(templateId);
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuthUser();

  const [bootErr, setBootErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [template, setTemplate] = useState<CardTemplateRow | null>(null);
  const [requests, setRequests] = useState<CardPurchaseRequestRow[]>([]);
  const [holders, setHolders] = useState<CustomerCardRow[]>([]);
  const [ledger, setLedger] = useState<CardLedgerRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [tpl, reqs, hs, lg] = await Promise.all([
      getCardTemplate(tid),
      listCardRequestsByTemplate(tid),
      listCustomerCardsByTemplate(tid),
      listCardLedger({ templateId: tid, limit: 200 }),
    ]);
    setTemplate(tpl);
    setRequests(reqs);
    setHolders(hs);
    setLedger(lg);
  }, [tid]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (authLoading) return;
      if (!user) {
        setBootErr('未登录');
        setLoading(false);
        return;
      }
      try {
        const row = await getShopBySlug(slug);
        if (!row) throw new Error('未找到该商户链接');
        if (row.data.ownerId !== user.uid) throw new Error('无权限');
        if (cancelled) return;
        setShopId(row.id);
        await refresh();
      } catch (e) {
        if (!cancelled) setBootErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug, refresh]);

  const highlightId = searchParams.get('highlight')?.trim() ?? '';
  const pendingRequests = useMemo(
    () => requests.filter((r) => r.data.status === 'pending'),
    [requests]
  );

  useEffect(() => {
    if (!highlightId || loading) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`card-request-${highlightId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add(
        'ring-2',
        'ring-indigo-400',
        'ring-offset-2',
        'rounded-xl'
      );
      window.setTimeout(() => {
        el.classList.remove(
          'ring-2',
          'ring-indigo-400',
          'ring-offset-2',
          'rounded-xl'
        );
      }, 2800);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [highlightId, loading, pendingRequests.length]);

  const handleConfirm = async (req: CardPurchaseRequestRow) => {
    if (!user) return;
    setBusyId(req.id);
    setMsg(null);
    try {
      await confirmCardPurchaseRequest(req.id, user.uid);
      setMsg('已确认到账，卡已激活/续值');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '确认失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: CardPurchaseRequestRow) => {
    if (!user) return;
    const reason = prompt('请填写拒绝原因（可选）') ?? '';
    if (!confirm('确认拒绝该购卡/充值请求？')) return;
    setBusyId(req.id);
    setMsg(null);
    try {
      await rejectCardPurchaseRequest(req.id, reason.trim(), user.uid);
      setMsg('已拒绝');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '拒绝失败');
    } finally {
      setBusyId(null);
    }
  };

  const back = useMemo(
    () => `/dashboard/${encodeURIComponent(slug)}/cards`,
    [slug]
  );

  if (authLoading || loading) {
    return (
      <PageShell title="优惠卡详情" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }
  if (bootErr || !template || !shopId) {
    return (
      <PageShell title="优惠卡详情" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr ?? '卡模板不存在'}</p>
        <Link className="mt-3 inline-block text-indigo-600" to={back}>
          返回
        </Link>
      </PageShell>
    );
  }

  const tpl = template.data;
  const isStored = tpl.type === 'stored';
  const valueLabel = isStored
    ? `面值 RM ${Number(tpl.faceValueOrUses ?? 0).toFixed(2)}`
    : `${Number(tpl.faceValueOrUses ?? 0)} 次`;

  const recentDoneRequests = requests
    .filter((r) => r.data.status !== 'pending')
    .slice(0, 10);

  const issuedHolders = holders.length;
  const totalRemain = holders.reduce(
    (acc, h) => acc + Number(h.data.remaining ?? 0),
    0
  );

  return (
    <PageShell title={tpl.name} subtitle={`/${slug} · 优惠卡详情`}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <p className="mb-3 text-sm">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to={back}>
          ← 返回卡管理
        </Link>
      </p>

      {/* 概览 */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-semibold text-gray-900">{tpl.name}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
              isStored
                ? 'bg-indigo-50 text-indigo-700'
                : 'bg-purple-50 text-purple-700'
            }`}
          >
            {isStored ? '钱包' : '次卡'}
          </span>
          {tpl.isActive === false ? (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
              已下架
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-gray-700">
          {valueLabel} · 售价 RM {Number(tpl.salePrice ?? 0).toFixed(2)} ·{' '}
          {Number(tpl.validityDays ?? 0) > 0
            ? `${tpl.validityDays} 天有效`
            : '永久有效'}
        </p>
        <p className="mt-1 text-xs text-gray-600">
          已售 {issuedHolders} 张 · 持有人未消耗{' '}
          {isStored ? `RM ${totalRemain.toFixed(2)}` : `${totalRemain} 次`}
        </p>
      </section>

      {/* 待确认 */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          待确认 <span className="text-xs text-gray-500">{pendingRequests.length} 条</span>
        </h2>
        {pendingRequests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
            暂无待处理请求。
          </p>
        ) : (
          <div className="space-y-2">
            {pendingRequests.map((req) => {
              const isStoredReq = req.data.templateTypeSnapshot === 'stored';
              return (
                <div
                  key={req.id}
                  id={`card-request-${req.id}`}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-1 text-xs text-amber-900">
                    <span className="font-semibold">
                      {req.data.kind === 'topup' ? '充值' : '购买'}
                    </span>
                    <span>{fmtTs(req.data.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-amber-900">
                    顾客：{req.data.customerName ?? '（未填）'}
                    {req.data.customerPhone ? ` · ${req.data.customerPhone}` : ''}
                    <span className="ml-1 text-amber-700">
                      ({req.data.customerKey.slice(-6)})
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-amber-900">
                    实付 RM {Number(req.data.payAmount).toFixed(2)} → 到账{' '}
                    {isStoredReq
                      ? `面值 RM ${Number(req.data.gainValue).toFixed(2)}`
                      : `${Number(req.data.gainValue)} 次`}
                  </div>
                  {Array.isArray(req.data.paymentScreenshots) &&
                  req.data.paymentScreenshots.length > 0 ? (
                    <>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {req.data.paymentScreenshots.map((s) => (
                          <div key={s.url} className="relative">
                            {s.duplicateRisk ? (
                              <span className="absolute left-0 top-0 z-10 rounded-br-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                                疑似重复
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setPreviewUrl(s.url)}
                              className="block w-full overflow-hidden rounded ring-1 ring-amber-200"
                            >
                              <img
                                src={s.url}
                                alt=""
                                className="h-20 w-full object-cover"
                              />
                            </button>
                          </div>
                        ))}
                      </div>
                      {req.data.paymentScreenshots.some((x) => x.duplicateRisk) ? (
                        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-[11px] leading-snug text-red-900">
                          <span className="font-semibold">自动重复识别：</span>
                          标红的凭证与<strong>本店其它购卡/充值请求</strong>
                          曾上传过<strong>完全相同文件</strong>的截图（按 SHA-256 指纹比对）。有可能是重复使用付款凭证，请人工核对后再确认到账。
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-amber-700">尚未上传截图</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white disabled:bg-gray-300"
                      onClick={() => void handleConfirm(req)}
                      disabled={
                        busyId === req.id ||
                        !req.data.paymentScreenshots ||
                        req.data.paymentScreenshots.length === 0
                      }
                    >
                      {busyId === req.id ? '处理中…' : '确认到账'}
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-red-200 bg-white py-2 text-xs font-medium text-red-700 disabled:opacity-50"
                      onClick={() => void handleReject(req)}
                      disabled={busyId === req.id}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 持有用户列表 */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          持有用户 <span className="text-xs text-gray-500">{holders.length} 人</span>
        </h2>
        {holders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
            还没有顾客购买。
          </p>
        ) : (
          <div className="space-y-2">
            {holders.map((h) => (
              <div key={h.id} className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="font-semibold">
                    {h.data.customerName ?? '（未填姓名）'}
                    {h.data.customerPhone ? ` · ${h.data.customerPhone}` : ''}
                    <span className="ml-1 font-normal text-gray-500">
                      ({h.data.customerKey.slice(-6)})
                    </span>
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] leading-none ${
                      h.data.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700'
                        : h.data.status === 'pending'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {cardStatusLabel[h.data.status]}
                  </span>
                </div>
                <div className="mt-0.5 text-gray-700">
                  剩余{' '}
                  {isStored
                    ? `RM ${Number(h.data.remaining ?? 0).toFixed(2)}`
                    : `${Number(h.data.remaining ?? 0)} 次`}{' '}
                  · 累计入{' '}
                  {isStored
                    ? `RM ${Number(h.data.totalIn ?? 0).toFixed(2)}`
                    : `${Number(h.data.totalIn ?? 0)} 次`}{' '}
                  · 累计出{' '}
                  {isStored
                    ? `RM ${Number(h.data.totalOut ?? 0).toFixed(2)}`
                    : `${Number(h.data.totalOut ?? 0)} 次`}
                </div>
                <div className="mt-0.5 text-gray-500">
                  激活：{fmtTs(h.data.activatedAt)} · 到期：
                  {h.data.validUntil ? fmtTs(h.data.validUntil) : '永久'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 流水 */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          流水 <span className="text-xs text-gray-500">最近 {ledger.length} 条</span>
        </h2>
        {ledger.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
            暂无流水。
          </p>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white">
            <ul className="divide-y divide-gray-100 text-xs">
              {ledger.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span
                      className={`mr-1 font-semibold ${ledgerColor[l.data.type]}`}
                    >
                      {ledgerLabel[l.data.type]}
                    </span>
                    <span className="text-gray-700">
                      {isStored
                        ? `${l.data.delta > 0 ? '+' : ''}RM ${Number(l.data.delta).toFixed(2)}`
                        : `${l.data.delta > 0 ? '+' : ''}${Number(l.data.delta)} 次`}
                    </span>
                    {l.data.note ? (
                      <span className="ml-1 text-gray-500">· {l.data.note}</span>
                    ) : null}
                    {l.data.orderNumber ? (
                      l.data.orderProjectId && l.data.orderShopSlug ? (
                        <Link
                          to={`/dashboard/${encodeURIComponent(l.data.orderShopSlug)}/order/${encodeURIComponent(l.data.orderProjectId)}/${encodeURIComponent(l.data.orderNumber)}`}
                          className="ml-1 text-indigo-600 underline-offset-2 hover:underline"
                        >
                          · 订单 #{l.data.orderNumber}
                        </Link>
                      ) : (
                        <span className="ml-1 text-indigo-600">
                          · 订单 #{l.data.orderNumber}
                        </span>
                      )
                    ) : null}
                    <div className="text-[11px] text-gray-500">
                      持卡人 {l.data.customerKey.slice(-6)} · 余{' '}
                      {isStored
                        ? `RM ${Number(l.data.remainingAfter ?? 0).toFixed(2)}`
                        : `${Number(l.data.remainingAfter ?? 0)} 次`}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-500">
                    {fmtTs(l.data.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 已处理请求（最近） */}
      {recentDoneRequests.length > 0 ? (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            最近已处理请求
          </h2>
          <div className="rounded-xl border border-gray-200 bg-white">
            <ul className="divide-y divide-gray-100 text-xs">
              {recentDoneRequests.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span
                      className={
                        r.data.status === 'confirmed'
                          ? 'font-semibold text-emerald-700'
                          : 'font-semibold text-rose-600'
                      }
                    >
                      {r.data.status === 'confirmed' ? '已确认' : '已拒绝'}
                    </span>{' '}
                    <span className="text-gray-700">
                      {r.data.kind === 'topup' ? '充值' : '购买'} ·{' '}
                      {r.data.customerName ?? '（未填）'} · 实付{' '}
                      {formatMYR(Number(r.data.payAmount))}
                    </span>
                    {r.data.rejectReason ? (
                      <span className="ml-1 text-rose-700">
                        · {r.data.rejectReason}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-500">
                    {fmtTs(r.data.confirmedAt ?? r.data.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* 截图预览 */}
      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-white text-lg leading-none text-gray-800 shadow"
              onClick={() => setPreviewUrl(null)}
            >
              ×
            </button>
            <img src={previewUrl} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
