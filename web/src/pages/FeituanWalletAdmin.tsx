import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PaymentScreenshotsPanel } from '../components/merchant/PaymentScreenshotsPanel';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { isFeituanAdmin } from '../lib/feituanService';
import {
  confirmFeituanWalletTopupRequest,
  effectiveFeituanWalletTopupStatus,
  listFeituanWalletAccounts,
  listFeituanWalletLedgerByUser,
  listFeituanWalletTopupRequests,
  getFeituanWalletSettings,
  rejectFeituanWalletTopupProof,
  saveFeituanWalletSettings,
  uploadFeituanWalletPaymentMethodImage,
  type FeituanWalletAccountRow,
  type FeituanWalletLedgerRow,
  type FeituanWalletTopupRequestRow,
} from '../lib/feituanWalletService';
import { formatMYR } from '../lib/formatMYR';
import type { FeituanWalletPaymentMethodDoc, FeituanWalletTopupTierDoc } from '../types/firestore';

function fmtTime(t: { toDate?: () => Date } | null | undefined): string {
  const d = t?.toDate?.();
  if (!d) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

type EffectiveTopup = ReturnType<typeof effectiveFeituanWalletTopupStatus>;

function topupEffective(
  doc: Parameters<typeof effectiveFeituanWalletTopupStatus>[0]
): EffectiveTopup {
  return effectiveFeituanWalletTopupStatus(doc);
}

function topupStatusLabel(s: EffectiveTopup): string {
  if (s === 'awaiting_payment') return '待付款';
  if (s === 'pending_review') return '待核实';
  if (s === 'confirmed') return '已入账';
  if (s === 'rejected') return '已终止';
  if (s === 'cancelled') return '已撤销';
  return s;
}

function topupStatusClass(s: EffectiveTopup): string {
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-950';
  if (s === 'pending_review') return 'bg-sky-100 text-sky-950';
  if (s === 'confirmed') return 'bg-emerald-100 text-emerald-900';
  if (s === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-700';
}

export default function FeituanWalletAdmin() {
  const { user, loading: authLoading } = useAuthUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tiers, setTiers] = useState<FeituanWalletTopupTierDoc[]>([]);
  const [methods, setMethods] = useState<FeituanWalletPaymentMethodDoc[]>([]);
  const [requests, setRequests] = useState<FeituanWalletTopupRequestRow[]>([]);
  const [accounts, setAccounts] = useState<FeituanWalletAccountRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedLedger, setSelectedLedger] = useState<FeituanWalletLedgerRow[]>([]);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [requestFilter, setRequestFilter] = useState<
    'pending_review' | 'awaiting_payment' | 'all' | 'confirmed' | 'closed'
  >('pending_review');
  const [requestSearch, setRequestSearch] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingMethodId, setUploadingMethodId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const ok = await isFeituanAdmin(user.uid);
      setAllowed(ok);
      if (!ok) return;
      const [settings, reqs, accs] = await Promise.all([
        getFeituanWalletSettings(),
        listFeituanWalletTopupRequests(),
        listFeituanWalletAccounts(),
      ]);
      setTiers(settings.topupTiers);
      setMethods(settings.paymentMethods);
      setRequests(reqs);
      setAccounts(accs);
      setSelectedUserId((prev) => prev || accs[0]?.id || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => {
      if (!user) {
        setAllowed(false);
        setLoading(false);
        return;
      }
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, refresh, user]);

  useEffect(() => {
    if (!selectedUserId) {
      queueMicrotask(() => setSelectedLedger([]));
      return;
    }
    let cancelled = false;
    void listFeituanWalletLedgerByUser(selectedUserId)
      .then((rows) => {
        if (!cancelled) setSelectedLedger(rows);
      })
      .catch(() => {
        if (!cancelled) setSelectedLedger([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  const saveSettings = async () => {
    if (!user) return;
    setMsg(null);
    try {
      await saveFeituanWalletSettings(user.uid, {
        topupTiers: tiers,
        paymentMethods: methods,
      });
      setMsg('钱包配置已保存');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  const confirmRequest = async (requestId: string) => {
    if (!user) return;
    setBusyId(requestId);
    setMsg(null);
    try {
      await confirmFeituanWalletTopupRequest(requestId, user.uid);
      setMsg('已确认充值并入账');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '确认失败');
    } finally {
      setBusyId(null);
    }
  };

  const rejectProof = async (requestId: string) => {
    if (!user) return;
    const reason =
      window.prompt('驳回凭证原因（顾客将回到待付款并需重新上传；可留空）：', '') ?? '';
    setBusyId(requestId);
    setMsg(null);
    try {
      await rejectFeituanWalletTopupProof(requestId, user.uid, reason);
      setMsg('已驳回凭证，申请已回到待付款');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '驳回失败');
    } finally {
      setBusyId(null);
    }
  };

  const uploadPaymentMethodQr = async (methodId: string, file: File | null) => {
    if (!user || !file) return;
    setUploadingMethodId(methodId);
    setMsg(null);
    try {
      const url = await uploadFeituanWalletPaymentMethodImage({
        actorUid: user.uid,
        file,
      });
      setMethods((rows) =>
        rows.map((row) => (row.id === methodId ? { ...row, qrCodeUrl: url } : row))
      );
      setMsg('收款码已上传，请记得保存钱包配置。');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '上传收款码失败');
    } finally {
      setUploadingMethodId(null);
    }
  };

  if (authLoading || loading || allowed == null) {
    return (
      <PageShell title="饭团钱包" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="饭团钱包" subtitle="无权限">
        <p className="text-sm text-gray-700">当前账号无饭团管理员权限。</p>
      </PageShell>
    );
  }

  const pendingCount = requests.filter((row) => topupEffective(row.data) === 'pending_review')
    .length;
  const totalBalance = accounts.reduce((sum, row) => sum + Number(row.data.balance ?? 0), 0);
  const totalPay = accounts.reduce((sum, row) => sum + Number(row.data.totalPayAmount ?? 0), 0);
  const totalBonus = accounts.reduce((sum, row) => sum + Number(row.data.totalBonusAmount ?? 0), 0);
  const totalSpent = accounts.reduce((sum, row) => sum + Number(row.data.totalSpentAmount ?? 0), 0);
  const selectedAccount = accounts.find((row) => row.id === selectedUserId) ?? null;
  const filteredRequests = [...requests]
    .filter((row) => {
      const eff = topupEffective(row.data);
      if (requestFilter === 'all') return true;
      if (requestFilter === 'closed') return eff === 'rejected' || eff === 'cancelled';
      return eff === requestFilter;
    })
    .filter((row) => {
      const kw = requestSearch.trim().toLowerCase();
      if (!kw) return true;
      return [
        row.id,
        row.data.userId,
        row.data.phoneMasked,
        row.data.phoneE164,
        row.data.rejectReason,
        row.data.lastProofRejectedReason,
      ]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(kw));
    })
    .sort((a, b) => {
      const ea = topupEffective(a.data);
      const eb = topupEffective(b.data);
      const pri = (e: EffectiveTopup) =>
        e === 'pending_review' ? 2 : e === 'awaiting_payment' ? 1 : 0;
      if (pri(ea) !== pri(eb)) return pri(eb) - pri(ea);
      return (b.data.createdAt?.toMillis?.() ?? 0) - (a.data.createdAt?.toMillis?.() ?? 0);
    });
  const filteredAccounts = accounts.filter((row) => {
    const kw = accountSearch.trim().toLowerCase();
    if (!kw) return true;
    return [row.id, row.data.userId, row.data.phoneMasked, row.data.phoneE164]
      .filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(kw));
  });
  const rangeStartMs = rangeStart ? new Date(`${rangeStart}T00:00:00`).getTime() : 0;
  const rangeEndMs = rangeEnd ? new Date(`${rangeEnd}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER;
  const ledgerAsc = [...selectedLedger].sort(
    (a, b) => (a.data.createdAt?.toMillis?.() ?? 0) - (b.data.createdAt?.toMillis?.() ?? 0)
  );
  let openingBalance = 0;
  let periodPay = 0;
  let periodBonus = 0;
  let periodCredit = 0;
  let periodSpent = 0;
  for (const row of ledgerAsc) {
    const t = row.data.createdAt?.toMillis?.() ?? 0;
    if (t < rangeStartMs) {
      openingBalance = Number(row.data.balanceAfter ?? openingBalance);
      continue;
    }
    if (t > rangeEndMs) continue;
    periodPay += Number(row.data.payAmount ?? 0);
    periodBonus += Number(row.data.bonusAmount ?? 0);
    periodCredit += Number(row.data.creditAmount ?? 0);
    if (row.data.type === 'order_payment') {
      periodSpent += Math.abs(Number(row.data.delta ?? 0));
    }
  }
  const endingBalance = openingBalance + periodCredit - periodSpent;

  return (
    <PageShell title="饭团钱包" subtitle={`待核实充值 ${pendingCount} 笔`}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/feituan"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          返回饭团管理
        </Link>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-50"
        >
          刷新
        </button>
      </div>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </p>
      ) : null}

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
          <p className="text-xs text-orange-800">当前余额负债</p>
          <p className="mt-1 text-xl font-bold text-orange-950">{formatMYR(totalBalance)}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <p className="text-xs text-emerald-800">历史实收</p>
          <p className="mt-1 text-xl font-bold text-emerald-950">{formatMYR(totalPay)}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-800">历史赠送</p>
          <p className="mt-1 text-xl font-bold text-amber-950">{formatMYR(totalBonus)}</p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <p className="text-xs text-indigo-800">历史抵扣</p>
          <p className="mt-1 text-xl font-bold text-indigo-950">{formatMYR(totalSpent)}</p>
        </div>
      </section>

      <section className="mb-5 rounded-xl border border-gray-100 bg-white p-3">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">充值档位</h2>
        <div className="space-y-2">
          {tiers.map((tier, index) => (
            <div
              key={tier.id}
              className="grid gap-2 rounded-lg border border-gray-100 p-2"
            >
              <input
                value={tier.label ?? ''}
                onChange={(e) =>
                  setTiers((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, label: e.target.value } : row))
                  )
                }
                placeholder="标签（选填）"
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={tier.payAmount}
                  type="number"
                  inputMode="decimal"
                  onChange={(e) =>
                    setTiers((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, payAmount: Number(e.target.value) } : row))
                    )
                  }
                  placeholder="实付 RM"
                  className="min-w-0 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                />
                <input
                  value={tier.bonusAmount}
                  type="number"
                  inputMode="decimal"
                  onChange={(e) =>
                    setTiers((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, bonusAmount: Number(e.target.value) } : row))
                    )
                  }
                  placeholder="赠送 RM"
                  className="min-w-0 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={tier.isActive !== false}
                    onChange={(e) =>
                      setTiers((rows) =>
                        rows.map((row, i) => (i === index ? { ...row, isActive: e.target.checked } : row))
                      )
                    }
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))}
                  className="shrink-0 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setTiers((rows) => [
                ...rows,
                {
                  id: `tier_${Date.now()}`,
                  label: '',
                  payAmount: 100,
                  bonusAmount: 0,
                  isActive: true,
                  sortOrder: rows.length,
                },
              ])
            }
            className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-900"
          >
            添加档位
          </button>
        </div>
      </section>

      <section className="mb-5 rounded-xl border border-gray-100 bg-white p-3">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">饭团收款码</h2>
        <div className="space-y-2">
          {methods.map((method, index) => (
            <div key={method.id} className="grid gap-2 rounded-lg border border-gray-100 p-2 md:grid-cols-[1fr_2fr_auto]">
              <input
                value={method.name}
                onChange={(e) =>
                  setMethods((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, name: e.target.value } : row))
                  )
                }
                placeholder="名称"
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
              />
              <input
                value={method.qrCodeUrl}
                onChange={(e) =>
                  setMethods((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, qrCodeUrl: e.target.value } : row))
                  )
                }
                placeholder="收款码图片 URL"
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <input
                  ref={(el) => {
                    fileInputRefs.current[method.id] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] ?? null;
                    void uploadPaymentMethodQr(method.id, file);
                    e.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={uploadingMethodId === method.id}
                  onClick={() => fileInputRefs.current[method.id]?.click()}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-900 disabled:opacity-50"
                >
                  {uploadingMethodId === method.id ? '上传中…' : '上传图片'}
                </button>
                <button
                  type="button"
                  onClick={() => setMethods((rows) => rows.filter((_, i) => i !== index))}
                  className="rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setMethods((rows) => [
                ...rows,
                {
                  id: `pm_${Date.now()}`,
                  name: '收款码',
                  qrCodeUrl: '',
                  isActive: true,
                  sortOrder: rows.length,
                },
              ])
            }
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-900"
          >
            添加收款码
          </button>
          <button
            type="button"
            onClick={() => void saveSettings()}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            保存钱包配置
          </button>
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">充值申请</h2>
          <span className="text-xs text-gray-500">当前显示 {filteredRequests.length} 笔</span>
        </div>
        <div className="mb-3 space-y-2 rounded-xl border border-gray-100 bg-white p-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {(
              [
                ['pending_review', '待核实'],
                ['awaiting_payment', '待付款'],
                ['all', '全部'],
                ['confirmed', '已入账'],
                ['closed', '已关闭'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRequestFilter(id)}
                className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                  requestFilter === id ? 'bg-orange-500 text-white' : 'bg-gray-50 text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={requestSearch}
            onChange={(e) => setRequestSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
            placeholder="搜索手机号、用户 ID、驳回说明"
          />
        </div>
        <div className="space-y-3">
          {filteredRequests.map((row) => {
            const eff = topupEffective(row.data);
            const shots = row.data.paymentScreenshots ?? [];
            return (
              <article
                key={row.id}
                className="rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
                      <span>{row.data.phoneMasked ?? row.data.userId}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${topupStatusClass(eff)}`}
                      >
                        {topupStatusLabel(eff)}
                      </span>
                    </p>
                    <p className="mt-1 text-gray-600">
                      实付 {formatMYR(row.data.payAmount)} · 赠送 {formatMYR(row.data.bonusAmount)} · 入账{' '}
                      {formatMYR(row.data.creditAmount)} · {fmtTime(row.data.createdAt)}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">申请编号 {row.id}</p>
                    {eff === 'awaiting_payment' ? (
                      <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-950">
                        待顾客上传付款截图后方可核实入账。
                        {row.data.lastProofRejectedReason ? (
                          <span className="mt-1 block text-amber-900">
                            上次驳回：{row.data.lastProofRejectedReason}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {row.data.rejectReason && (eff === 'rejected' || eff === 'cancelled') ? (
                      <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-red-700">
                        终止说明：{row.data.rejectReason}
                      </p>
                    ) : null}
                  </div>
                </div>

                {eff === 'pending_review' ? (
                  <>
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                        付款凭证
                      </p>
                      <PaymentScreenshotsPanel
                        paymentScreenshots={row.data.paymentScreenshots}
                        variant="wallet_recharge"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void confirmRequest(row.id)}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {busyId === row.id ? '处理中…' : '确认入账'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void rejectProof(row.id)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950 disabled:opacity-60"
                      >
                        驳回凭证
                      </button>
                    </div>
                  </>
                ) : shots.length > 0 && eff === 'confirmed' ? (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="mb-2 text-[11px] font-semibold text-gray-600">入账时凭证</p>
                    <div className="flex flex-wrap gap-2">
                      {shots.map((shot) => (
                        <a key={shot.url} href={shot.url} target="_blank" rel="noreferrer">
                          <img
                            src={shot.url}
                            alt="充值付款截图"
                            className="h-20 w-20 rounded-md border border-gray-100 object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {filteredRequests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">
              当前筛选下没有充值申请。
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">用户钱包汇总</h2>
          <input
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm sm:max-w-xs"
            placeholder="搜索手机号或用户 ID"
          />
        </div>
        <div className="space-y-2">
          {filteredAccounts.map((row) => (
            <article key={row.id} className="rounded-xl border border-gray-100 bg-white p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {row.data.phoneMasked ?? row.id}
                  </p>
                  <p className="mt-1 text-gray-600">
                    实充 {formatMYR(row.data.totalPayAmount)} · 赠送 {formatMYR(row.data.totalBonusAmount)} · 抵扣{' '}
                    {formatMYR(row.data.totalSpentAmount)}
                  </p>
                </div>
                <p className="text-right text-sm font-bold text-orange-700">
                  {formatMYR(row.data.balance)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserId(row.id)}
                className="mt-2 rounded-lg border border-orange-100 bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-900"
              >
                查看区间汇总
              </button>
            </article>
          ))}
          {filteredAccounts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">
              未找到匹配的钱包账户。
            </p>
          ) : null}
        </div>
      </section>

      {selectedAccount ? (
        <section className="mt-5 rounded-xl border border-orange-100 bg-orange-50/50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-orange-950">
            用户区间汇总：{selectedAccount.data.phoneMasked ?? selectedAccount.id}
          </h2>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="text-xs text-gray-700">
              开始日期
              <input
                type="date"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-orange-100 px-2"
              />
            </label>
            <label className="text-xs text-gray-700">
              结束日期
              <input
                type="date"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-orange-100 px-2"
              />
            </label>
          </div>
          <div className="grid gap-2 text-xs md:grid-cols-3">
            <div className="rounded-lg bg-white px-3 py-2">期初余额：{formatMYR(openingBalance)}</div>
            <div className="rounded-lg bg-white px-3 py-2">实际充值：{formatMYR(periodPay)}</div>
            <div className="rounded-lg bg-white px-3 py-2">赠送金额：{formatMYR(periodBonus)}</div>
            <div className="rounded-lg bg-white px-3 py-2">钱包入账：{formatMYR(periodCredit)}</div>
            <div className="rounded-lg bg-white px-3 py-2">订单抵扣：{formatMYR(periodSpent)}</div>
            <div className="rounded-lg bg-white px-3 py-2">期末余额：{formatMYR(endingBalance)}</div>
          </div>
          <p className="mt-2 text-[11px] text-orange-900">
            校验：期初余额 + 钱包入账 - 订单抵扣 = 期末余额。
          </p>
        </section>
      ) : null}
    </PageShell>
  );
}
