import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { getShopBySlug } from '../../lib/shopService';
import {
  merchantCanManageShopSettingsAndProjects,
  resolveMerchantShopRole,
  type MerchantShopActorRole,
} from '../../lib/permissionService';
import { H5_COLUMN_CLASS } from '../../lib/shopTheme';
import {
  cardRequestAwaitingCustomerProof,
  cardRequestNeedsMerchantConfirm,
  cardTemplateHasIssued,
  confirmCardPurchaseRequest,
  createCardTemplate,
  deleteCardTemplate,
  listCardRequestsByShop,
  listCardTemplatesByShop,
  rejectCardPurchaseRequest,
  setCardTemplateActive,
  updateCardTemplate,
  type CardPurchaseRequestRow,
  type CardTemplateRow,
} from '../../lib/cardService';
import type {
  CardTemplateDoc,
  CardTopupRule,
  CardType,
} from '../../types/firestore';

type EditingDraft = {
  id: string | null;
  name: string;
  type: CardType;
  faceValueOrUses: number;
  salePrice: number;
  validityDays: number;
  description: string;
  topupRules: CardTopupRule[];
  isActive: boolean;
};

function blankDraftForType(type: CardType): EditingDraft {
  return {
    id: null,
    name: type === 'stored' ? '钱包' : '',
    type,
    faceValueOrUses: 0,
    salePrice: 0,
    validityDays: 0,
    description: '',
    topupRules: [],
    isActive: true,
  };
}

function fromDoc(row: CardTemplateRow): EditingDraft {
  return {
    id: row.id,
    name:
      row.data.type === 'stored'
        ? (row.data.name?.trim() || '钱包')
        : (row.data.name ?? ''),
    type: row.data.type,
    faceValueOrUses: Number(row.data.faceValueOrUses ?? 0) || 0,
    salePrice: Number(row.data.salePrice ?? 0) || 0,
    validityDays: Number(row.data.validityDays ?? 0) || 0,
    description: row.data.description ?? '',
    topupRules: Array.isArray(row.data.topupRules)
      ? row.data.topupRules.map((r) => ({
          pay: Number(r.pay ?? 0) || 0,
          gain: Number(r.gain ?? 0) || 0,
        }))
      : [],
    isActive: row.data.isActive !== false,
  };
}

const inputCls =
  'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

export default function CardTemplates() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopOwnerUid, setShopOwnerUid] = useState<string | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CardTemplateRow[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<
    CardPurchaseRequestRow[]
  >([]);
  const [issuedMap, setIssuedMap] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<EditingDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const [list, reqs] = await Promise.all([
        listCardTemplatesByShop(sid, { includeInactive: true }),
        listCardRequestsByShop(sid),
      ]);
      setRows(list);
      setPurchaseRequests(reqs);
      const issued: Record<string, boolean> = {};
      await Promise.all(
        list.map(async (r) => {
          issued[r.id] = await cardTemplateHasIssued(r.id);
        })
      );
      setIssuedMap(issued);
    } finally {
      setLoading(false);
    }
  }, []);

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
        const eff: MerchantShopActorRole | null =
          row.data.ownerId === user.uid
            ? 'owner'
            : await resolveMerchantShopRole(user.uid, row);
        if (!merchantCanManageShopSettingsAndProjects(eff)) {
          throw new Error('无权限：仅店主或高级管理员可访问');
        }
        if (cancelled) return;
        setShopId(row.id);
        setShopOwnerUid(row.data.ownerId);
        await refresh(row.id);
      } catch (e) {
        if (!cancelled) {
          setBootErr(e instanceof Error ? e.message : '加载失败');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug, refresh]);

  const handleSave = async () => {
    if (!draft || !shopId || !shopOwnerUid) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        name: draft.name,
        type: draft.type,
        faceValueOrUses: Number(draft.faceValueOrUses) || 0,
        salePrice: Number(draft.salePrice) || 0,
        validityDays: Number(draft.validityDays) || 0,
        description: draft.description?.trim() || '',
        topupRules: draft.topupRules,
        isActive: draft.isActive,
      };
      if (draft.id) {
        await updateCardTemplate(draft.id, payload);
        setMsg('已保存修改');
      } else {
        await createCardTemplate(shopId, shopOwnerUid, payload);
        setMsg(draft.type === 'stored' ? '钱包已开通' : '已新建次卡');
      }
      setDraft(null);
      await refresh(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: CardTemplateRow) => {
    if (!shopId) return;
    if (!confirm(`确认删除「${row.data.name}」？此操作不可撤销。`)) return;
    try {
      await deleteCardTemplate(row.id);
      setMsg('已删除');
      await refresh(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleToggleActive = async (row: CardTemplateRow) => {
    if (!shopId) return;
    try {
      await setCardTemplateActive(row.id, row.data.isActive === false);
      await refresh(shopId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '切换失败');
    }
  };

  const back = useMemo(
    () => `/dashboard/${encodeURIComponent(slug)}`,
    [slug]
  );

  const walletTemplates = useMemo(
    () => rows.filter((r) => r.data.type === 'stored'),
    [rows]
  );
  const passTemplates = useMemo(
    () => rows.filter((r) => r.data.type === 'pass'),
    [rows]
  );

  if (authLoading || loading) {
    return (
      <PageShell title="优惠卡管理" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (bootErr) {
    return (
      <PageShell title="优惠卡管理" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr}</p>
        <Link className="mt-3 inline-block text-indigo-600" to="/dashboard">
          返回
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="优惠卡管理" subtitle={`/${slug} · 钱包 / 次卡`}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <div className="mb-4">
        <Link to={back} className="text-sm text-indigo-600 underline-offset-2 hover:underline">
          ← 返回概览
        </Link>
      </div>

      <div className="space-y-8">
        {/* 每店仅一个钱包模板：未开通时只展示简介 + 开通；开通后与次卡分区展示 */}
        <section>
          <h3 className="mb-3 text-base font-bold tracking-tight text-indigo-900 sm:text-lg">
            钱包（按金额抵扣）
          </h3>
          {walletTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-6">
              <p className="text-sm leading-relaxed text-gray-800">
                每店只需开通<strong className="font-semibold text-indigo-900">一个钱包</strong>
                ：顾客储值余额可在下单时按金额抵扣。请先设定<strong>首购面值与售价</strong>
                ，并配置<strong>充值档位</strong>以便顾客后续充值。
              </p>
              <button
                type="button"
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                onClick={() => setDraft(blankDraftForType('stored'))}
              >
                开通钱包
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {walletTemplates.map((row) => (
                <CardRow
                  key={row.id}
                  row={row}
                  issued={!!issuedMap[row.id]}
                  onOpen={() =>
                    navigate(
                      `/dashboard/${encodeURIComponent(slug)}/cards/${encodeURIComponent(row.id)}`
                    )
                  }
                  onEdit={() => setDraft(fromDoc(row))}
                  onDelete={() => void handleDelete(row)}
                  onToggleActive={() => void handleToggleActive(row)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold tracking-tight text-purple-900 sm:text-lg">
              次卡（按次数抵扣）
            </h3>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-900 hover:bg-purple-100"
              onClick={() => setDraft(blankDraftForType('pass'))}
            >
              + 新增次卡
            </button>
          </div>
          {passTemplates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-purple-100 bg-purple-50/30 px-4 py-6 text-center text-sm text-gray-600">
              暂无次卡。点击右上方「新增次卡」添加可按次数抵扣的优惠卡。
            </p>
          ) : (
            <div className="space-y-3">
              {passTemplates.map((row) => (
                <CardRow
                  key={row.id}
                  row={row}
                  issued={!!issuedMap[row.id]}
                  onOpen={() =>
                    navigate(
                      `/dashboard/${encodeURIComponent(slug)}/cards/${encodeURIComponent(row.id)}`
                    )
                  }
                  onEdit={() => setDraft(fromDoc(row))}
                  onDelete={() => void handleDelete(row)}
                  onToggleActive={() => void handleToggleActive(row)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <CardPurchaseOrdersSection
        slug={slug}
        requests={purchaseRequests}
        userId={user?.uid ?? null}
        setMsg={setMsg}
        onRefresh={() => {
          if (shopId) void refresh(shopId);
        }}
      />

      {draft ? (
        <CardEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void handleSave()}
          saving={saving}
        />
      ) : null}
    </PageShell>
  );
}

type CardOrdersTab =
  | 'all'
  | 'pending_confirm'
  | 'confirmed'
  | 'pending_payment'
  | 'rejected';

function matchesOrdersTab(
  req: CardPurchaseRequestRow,
  tab: CardOrdersTab
): boolean {
  const d = req.data;
  if (tab === 'all') return true;
  if (tab === 'confirmed') return d.status === 'confirmed';
  if (tab === 'rejected') return d.status === 'rejected';
  if (tab === 'pending_confirm') return cardRequestNeedsMerchantConfirm(d);
  if (tab === 'pending_payment') return cardRequestAwaitingCustomerProof(d);
  return false;
}

function fmtReqTs(t: { toDate?: () => Date } | null | undefined): string {
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

function CardPurchaseOrdersSection({
  slug,
  requests,
  userId,
  setMsg,
  onRefresh,
}: {
  slug: string;
  requests: CardPurchaseRequestRow[];
  userId: string | null;
  setMsg: (m: string | null) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<CardOrdersTab>('pending_confirm');
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    return {
      all: requests.length,
      pending_confirm: requests.filter((r) =>
        cardRequestNeedsMerchantConfirm(r.data)
      ).length,
      confirmed: requests.filter((r) => r.data.status === 'confirmed').length,
      pending_payment: requests.filter((r) =>
        cardRequestAwaitingCustomerProof(r.data)
      ).length,
      rejected: requests.filter((r) => r.data.status === 'rejected').length,
    };
  }, [requests]);

  const filtered = useMemo(() => {
    const rows = requests.filter((r) => matchesOrdersTab(r, tab));
    rows.sort((a, b) => {
      const ta = a.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.data.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
    return rows;
  }, [requests, tab]);

  const tabs: { id: CardOrdersTab; label: string }[] = [
    { id: 'pending_confirm', label: '待确认' },
    { id: 'all', label: '全部' },
    { id: 'confirmed', label: '已确认' },
    { id: 'pending_payment', label: '待付款' },
    { id: 'rejected', label: '已拒绝' },
  ];

  const detailHref = (req: CardPurchaseRequestRow) =>
    `/dashboard/${encodeURIComponent(slug)}/cards/${encodeURIComponent(req.data.templateId)}?highlight=${encodeURIComponent(req.id)}`;

  const handleConfirm = async (req: CardPurchaseRequestRow) => {
    if (!userId) return;
    setBusyId(req.id);
    setMsg(null);
    try {
      await confirmCardPurchaseRequest(req.id, userId);
      setMsg('已确认到账');
      await onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '确认失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: CardPurchaseRequestRow) => {
    if (!userId) return;
    const reason = prompt('请填写拒绝原因（可选）') ?? '';
    if (!confirm('确认拒绝该购卡/充值请求？')) return;
    setBusyId(req.id);
    setMsg(null);
    try {
      await rejectCardPurchaseRequest(req.id, reason.trim(), userId);
      setMsg('已拒绝');
      await onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '拒绝失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">
        购卡 / 充值订单
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        汇总本店所有钱包与次卡的购买、充值请求。「待付款」表示顾客尚未上传付款截图；「待确认」表示已上传凭证，可在此直接确认或拒绝。
      </p>

      <div className="mb-3 flex flex-wrap gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              tab === t.id
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="ml-0.5 tabular-nums opacity-80">
              ({counts[t.id]})
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-500">
          当前筛选下暂无记录。
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((req) => {
            const d = req.data;
            const isStored = d.templateTypeSnapshot === 'stored';
            const shots = Array.isArray(d.paymentScreenshots)
              ? d.paymentScreenshots
              : [];
            const dupShot = shots.some((s) => s.duplicateRisk);
            const detailLink = detailHref(req);
            const canQuickAct =
              cardRequestNeedsMerchantConfirm(d) && userId != null;

            return (
              <div
                key={req.id}
                className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-gray-900">
                        {d.templateNameSnapshot || '优惠卡'}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          isStored
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}
                      >
                        {isStored ? '钱包' : '次卡'}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {d.kind === 'topup' ? '充值' : '购买'}
                      </span>
                      {d.status === 'pending' &&
                      cardRequestNeedsMerchantConfirm(d) ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                          待确认
                        </span>
                      ) : null}
                      {d.status === 'pending' &&
                      cardRequestAwaitingCustomerProof(d) ? (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                          待付款截图
                        </span>
                      ) : null}
                      {d.status === 'confirmed' ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          已确认
                        </span>
                      ) : null}
                      {d.status === 'rejected' ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                          已拒绝
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-600">
                      {fmtReqTs(d.createdAt)} · 顾客 {d.customerName ?? '—'}{' '}
                      {d.customerPhone ? `· ${d.customerPhone}` : ''}
                      <span className="text-gray-400">
                        （{d.customerKey.slice(-6)}）
                      </span>
                    </p>
                    <p className="mt-1 font-medium text-gray-900">
                      实付 RM {Number(d.payAmount).toFixed(2)} → 到账{' '}
                      {isStored
                        ? `面值 RM ${Number(d.gainValue).toFixed(2)}`
                        : `${Number(d.gainValue)} 次`}
                    </p>
                    {dupShot ? (
                      <p className="mt-1 text-[11px] font-medium text-red-700">
                        含自动识别的疑似重复凭证，请核对。
                      </p>
                    ) : null}
                    {d.status === 'rejected' && d.rejectReason ? (
                      <p className="mt-1 text-[11px] text-gray-500">
                        原因：{d.rejectReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Link
                      to={detailLink}
                      className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700"
                    >
                      卡详情
                    </Link>
                  </div>
                </div>
                {shots.length > 0 ? (
                  <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                    {shots.slice(0, 4).map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="relative h-14 w-14 shrink-0 overflow-hidden rounded border border-gray-100 bg-gray-50"
                      >
                        {s.duplicateRisk ? (
                          <span className="absolute left-0 top-0 z-10 bg-red-600 px-0.5 text-[8px] font-bold text-white">
                            重复
                          </span>
                        ) : null}
                        <img
                          src={s.url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </a>
                    ))}
                    {shots.length > 4 ? (
                      <span className="flex h-14 w-8 shrink-0 items-center text-[10px] text-gray-400">
                        +{shots.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {canQuickAct ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white disabled:bg-gray-300"
                      disabled={busyId === req.id}
                      onClick={() => void handleConfirm(req)}
                    >
                      {busyId === req.id ? '处理中…' : '确认到账'}
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-red-200 bg-white py-2 text-xs font-medium text-red-700 disabled:opacity-50"
                      disabled={busyId === req.id}
                      onClick={() => void handleReject(req)}
                    >
                      拒绝
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type CardRowProps = {
  row: CardTemplateRow;
  issued: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
};

function CardRow({ row, issued, onOpen, onEdit, onDelete, onToggleActive }: CardRowProps) {
  const d = row.data as CardTemplateDoc;
  const typeLabel = d.type === 'stored' ? '钱包' : '次卡';
  const valueLabel =
    d.type === 'stored'
      ? `面值 RM ${Number(d.faceValueOrUses ?? 0).toFixed(2)}`
      : `${Number(d.faceValueOrUses ?? 0)} 次`;
  const validityLabel =
    Number(d.validityDays ?? 0) > 0 ? `${d.validityDays} 天有效` : '永久有效';
  const isActive = d.isActive !== false;

  return (
    <div
      className={`rounded-xl border p-3 ${
        isActive ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold text-gray-900">
              {d.name || '未命名卡'}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                d.type === 'stored'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'bg-purple-50 text-purple-700'
              }`}
            >
              {typeLabel}
            </span>
            {!isActive ? (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                已下架
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-gray-600">
            {valueLabel} · 售价 RM {Number(d.salePrice ?? 0).toFixed(2)} ·{' '}
            {validityLabel}
          </p>
          {d.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-gray-500">
              {d.description}
            </p>
          ) : null}
          {Array.isArray(d.topupRules) && d.topupRules.length > 0 ? (
            <p className="mt-1 text-[11px] text-gray-500">
              充值档位：
              {d.topupRules
                .map(
                  (r) =>
                    `付 RM ${Number(r.pay).toFixed(2)} 得 ${
                      d.type === 'stored'
                        ? `面值 RM ${Number(r.gain).toFixed(2)}`
                        : `${Number(r.gain)} 次`
                    }`
                )
                .join('；')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
            onClick={onOpen}
          >
            详情
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
            onClick={onEdit}
          >
            编辑
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
            onClick={onToggleActive}
          >
            {isActive ? '下架' : '上架'}
          </button>
          {!issued ? (
            <button
              type="button"
              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
              onClick={onDelete}
            >
              删除
            </button>
          ) : (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
              已售出 · 不可删
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type CardEditorProps = {
  draft: EditingDraft;
  onChange: (next: EditingDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
};

function CardEditor({ draft, onChange, onCancel, onSave, saving }: CardEditorProps) {
  const set = (patch: Partial<EditingDraft>) => onChange({ ...draft, ...patch });
  const isStored = draft.type === 'stored';
  const valueLabel = isStored ? '面值 (RM)' : '使用次数';

  const modalTitle =
    draft.id != null
      ? isStored
        ? '编辑钱包'
        : '编辑次卡'
      : isStored
        ? '开通钱包'
        : '新增次卡';

  const addRule = () =>
    set({ topupRules: [...draft.topupRules, { pay: 0, gain: 0 }] });
  const updateRule = (i: number, patch: Partial<CardTopupRule>) => {
    const next = draft.topupRules.slice();
    next[i] = { ...next[i]!, ...patch };
    set({ topupRules: next });
  };
  const removeRule = (i: number) => {
    const next = draft.topupRules.slice();
    next.splice(i, 1);
    set({ topupRules: next });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl ${H5_COLUMN_CLASS}`}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{modalTitle}</h2>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-gray-500"
            onClick={onCancel}
          >
            关闭
          </button>
        </div>

        <div className="space-y-3">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              isStored
                ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
                : 'border-purple-200 bg-purple-50 text-purple-900'
            }`}
          >
            {isStored ? (
              <>
                <strong>钱包</strong>
                ：按订单金额抵扣；名称固定为「钱包」，与次卡分开配置。
              </>
            ) : (
              <>
                <strong>次卡（优惠卡）</strong>
                ：按次数抵扣；每张次卡单独起名，与钱包分开配置。
              </>
            )}
          </div>

          {draft.type === 'pass' ? (
            <label className="block text-sm text-gray-800">
              卡名称 <span className="text-xs text-gray-500">（必填）</span>
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="例如：午餐次卡"
              />
            </label>
          ) : (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">
              钱包名称固定为「钱包」，全店仅一种钱包。
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-gray-800">
              {valueLabel}
              <input
                className={inputCls}
                type="number"
                min={0}
                step={isStored ? '0.01' : '1'}
                value={draft.faceValueOrUses || ''}
                onChange={(e) =>
                  set({ faceValueOrUses: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="block text-sm text-gray-800">
              售价 (RM)
              <input
                className={inputCls}
                type="number"
                min={0}
                step="0.01"
                value={draft.salePrice || ''}
                onChange={(e) =>
                  set({ salePrice: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>

          <label className="block text-sm text-gray-800">
            有效期（天）·{' '}
            <span className="text-xs text-gray-500">
              {draft.type === 'stored'
                ? '钱包推荐永久有效（留 0）'
                : '0 = 永久有效'}
            </span>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="1"
              value={draft.validityDays || ''}
              onChange={(e) =>
                set({ validityDays: Number(e.target.value) || 0 })
              }
            />
          </label>

          <label className="block text-sm text-gray-800">
            备注 / 描述（可选）
            <textarea
              className={`${inputCls} min-h-[3.5rem]`}
              placeholder="例如：仅限自取使用 / 不可与折扣同享"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">
                充值档位（可选）
              </span>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600"
                onClick={addRule}
              >
                + 添加档位
              </button>
            </div>
            {draft.topupRules.length === 0 ? (
              <p className="text-xs text-gray-500">
                未配置充值档位时，仍可按"售价"购买首张，但顾客无法在前端续费。
              </p>
            ) : (
              <div className="space-y-2">
                {draft.topupRules.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-gray-700"
                  >
                    <span>付</span>
                    <input
                      className="w-24 rounded-md border border-gray-200 px-2 py-1"
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.pay || ''}
                      onChange={(e) =>
                        updateRule(i, { pay: Number(e.target.value) || 0 })
                      }
                    />
                    <span>RM 得</span>
                    <input
                      className="w-24 rounded-md border border-gray-200 px-2 py-1"
                      type="number"
                      min={0}
                      step={isStored ? '0.01' : '1'}
                      value={r.gain || ''}
                      onChange={(e) =>
                        updateRule(i, { gain: Number(e.target.value) || 0 })
                      }
                    />
                    <span>{isStored ? 'RM 面值' : '次'}</span>
                    <button
                      type="button"
                      className="ml-auto rounded-md border border-red-200 px-2 py-0.5 text-red-700"
                      onClick={() => removeRule(i)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
            />
            上架（顾客可购买）
          </label>

          {!isStored ? (
            <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-800">
              本张卡可抵扣的"产品 / 套餐方案"将在第二阶段：在产品上架页选择「可使用此次卡」。当前仅完成卡的基础配置。
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700"
              onClick={onCancel}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
