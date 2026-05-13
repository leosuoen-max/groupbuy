import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { isFeituanAdmin } from '../lib/feituanService';
import { formatMYR } from '../lib/formatMYR';
import {
  confirmFeituanWalletTopupRequest,
  listFeituanWalletAccounts,
  listFeituanWalletLedgerByUser,
  listFeituanWalletTopupRequests,
  getFeituanWalletSettings,
  rejectFeituanWalletTopupRequest,
  saveFeituanWalletSettings,
  type FeituanWalletAccountRow,
  type FeituanWalletLedgerRow,
  type FeituanWalletTopupRequestRow,
} from '../lib/feituanWalletService';
import type {
  FeituanWalletPaymentMethodDoc,
  FeituanWalletTopupTierDoc,
} from '../types/firestore';

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

function statusLabel(status: string): string {
  if (status === 'pending') return '待确认';
  if (status === 'confirmed') return '已入账';
  if (status === 'rejected') return '已驳回';
  if (status === 'cancelled') return '已撤销';
  return status;
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
  const [busyId, setBusyId] = useState<string | null>(null);

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
    if (!user) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedLedger([]);
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

  const rejectRequest = async (requestId: string) => {
    if (!user) return;
    const reason = window.prompt('驳回原因（可留空）：', '') ?? '';
    setBusyId(requestId);
    setMsg(null);
    try {
      await rejectFeituanWalletTopupRequest(requestId, user.uid, reason);
      setMsg('已驳回');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '驳回失败');
    } finally {
      setBusyId(null);
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

  const pendingCount = requests.filter((row) => row.data.status === 'pending').length;
  const totalBalance = accounts.reduce((sum, row) => sum + Number(row.data.balance ?? 0), 0);
  const totalPay = accounts.reduce((sum, row) => sum + Number(row.data.totalPayAmount ?? 0), 0);
  const totalBonus = accounts.reduce((sum, row) => sum + Number(row.data.totalBonusAmount ?? 0), 0);
  const totalSpent = accounts.reduce((sum, row) => sum + Number(row.data.totalSpentAmount ?? 0), 0);
  const selectedAccount = accounts.find((row) => row.id === selectedUserId) ?? null;
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
    <PageShell title="饭团钱包" subtitle={`待确认充值 ${pendingCount} 笔`}>
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
            <div key={tier.id} className="grid gap-2 rounded-lg border border-gray-100 p-2 md:grid-cols-5">
              <input
                value={tier.label ?? ''}
                onChange={(e) =>
                  setTiers((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, label: e.target.value } : row))
                  )
                }
                placeholder="标签"
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
              />
              <input
                value={tier.payAmount}
                type="number"
                onChange={(e) =>
                  setTiers((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, payAmount: Number(e.target.value) } : row))
                  )
                }
                placeholder="实付"
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
              />
              <input
                value={tier.bonusAmount}
                type="number"
                onChange={(e) =>
                  setTiers((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, bonusAmount: Number(e.target.value) } : row))
                  )
                }
                placeholder="赠送"
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
              />
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
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
                className="rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700"
              >
                删除
              </button>
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
              <button
                type="button"
                onClick={() => setMethods((rows) => rows.filter((_, i) => i !== index))}
                className="rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700"
              >
                删除
              </button>
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
        <h2 className="mb-2 text-sm font-semibold text-gray-900">充值申请</h2>
        <div className="space-y-2">
          {requests.map((row) => (
            <article key={row.id} className="rounded-xl border border-gray-100 bg-white p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {row.data.phoneMasked ?? row.data.userId} · {statusLabel(row.data.status)}
                  </p>
                  <p className="mt-1 text-gray-600">
                    实付 {formatMYR(row.data.payAmount)} · 赠送 {formatMYR(row.data.bonusAmount)} · 入账{' '}
                    {formatMYR(row.data.creditAmount)} · {fmtTime(row.data.createdAt)}
                  </p>
                  <p className="mt-1 text-gray-500">截图 {row.data.paymentScreenshots.length} 张</p>
                </div>
                {row.data.status === 'pending' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void confirmRequest(row.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      确认入账
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void rejectRequest(row.id)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
                    >
                      驳回
                    </button>
                  </div>
                ) : null}
              </div>
              {row.data.paymentScreenshots.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.data.paymentScreenshots.map((shot) => (
                    <a key={shot.url} href={shot.url} target="_blank" rel="noreferrer">
                      <img src={shot.url} alt="" className="h-14 w-14 rounded-md object-cover" />
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">用户钱包汇总</h2>
        <div className="space-y-2">
          {accounts.map((row) => (
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
