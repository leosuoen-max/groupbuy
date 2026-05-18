import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useAuthUser } from '../hooks/useAuthUser';
import { formatMYR } from '../lib/formatMYR';
import {
  ensureFeituanWalletAccount,
  effectiveFeituanWalletTopupStatus,
  listFeituanWalletLedgerByUser,
  listFeituanWalletTopupRequestsByUser,
  type FeituanWalletAccountRow,
  type FeituanWalletLedgerRow,
  type FeituanWalletTopupRequestRow,
} from '../lib/feituanWalletService';

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

function requestStatusLabel(status: string): string {
  if (status === 'awaiting_payment') return '待付款';
  if (status === 'pending_review') return '待核实';
  if (status === 'pending') return '处理中';
  if (status === 'confirmed') return '已入账';
  if (status === 'rejected') return '已终止';
  if (status === 'cancelled') return '已撤销';
  return status;
}

function requestStatusClass(status: string): string {
  if (status === 'awaiting_payment') return 'bg-amber-100 text-amber-950';
  if (status === 'pending_review') return 'bg-sky-100 text-sky-950';
  if (status === 'pending') return 'bg-amber-100 text-amber-900';
  if (status === 'confirmed') return 'bg-emerald-100 text-emerald-900';
  if (status === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-700';
}

function ledgerTypeLabel(type: string): string {
  if (type === 'topup') return '充值入账';
  if (type === 'order_payment') return '订单抵扣';
  if (type === 'adjustment') return '人工调整';
  return type;
}

export default function FeituanWallet() {
  const { user, loading: authLoading } = useAuthUser();
  const [account, setAccount] = useState<FeituanWalletAccountRow | null>(null);
  const [requests, setRequests] = useState<FeituanWalletTopupRequestRow[]>([]);
  const [ledger, setLedger] = useState<FeituanWalletLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.phoneNumber) return;
    setLoading(true);
    setErr(null);
    try {
      const acc = await ensureFeituanWalletAccount(user);
      const [reqs, ledgers] = await Promise.all([
        listFeituanWalletTopupRequestsByUser(user.uid),
        listFeituanWalletLedgerByUser(user.uid),
      ]);
      setAccount(acc);
      setRequests(reqs);
      setLedger(ledgers);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载钱包失败');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => {
      if (!user?.phoneNumber) {
        setLoading(false);
        return;
      }
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, refresh, user?.phoneNumber]);

  const periodTotals = useMemo(() => {
    const topupPay = ledger.reduce((s, row) => s + Number(row.data.payAmount ?? 0), 0);
    const topupBonus = ledger.reduce((s, row) => s + Number(row.data.bonusAmount ?? 0), 0);
    const spent = ledger
      .filter((row) => row.data.type === 'order_payment')
      .reduce((s, row) => s + Math.abs(Number(row.data.delta ?? 0)), 0);
    return { topupPay, topupBonus, spent };
  }, [ledger]);
  const pendingRequests = requests.filter(
    (row) => effectiveFeituanWalletTopupStatus(row.data) === 'pending_review'
  ).length;

  if (authLoading || loading) {
    return (
      <PageShell title="饭团钱包" subtitle="加载中">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user?.phoneNumber) {
    return (
      <PageShell title="饭团钱包" subtitle="需要手机号验证">
        <p className="mb-3 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-950">
          使用饭团钱包前，请先完成手机号验证。
        </p>
        <Link
          to="/feituan/account?returnTo=/feituan/wallet"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white"
        >
          去验证手机号
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="饭团钱包" subtitle={account?.data.phoneMasked ?? '手机号账户'}>
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      <section className="mb-4 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4">
        <p className="text-xs font-medium text-orange-900">当前余额</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-orange-950">
          {formatMYR(account?.data.balance ?? 0)}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-orange-950">
          <div className="rounded-lg bg-white/80 px-2 py-2">
            <p className="text-orange-700">累计实充</p>
            <p className="font-semibold">{formatMYR(account?.data.totalPayAmount ?? 0)}</p>
          </div>
          <div className="rounded-lg bg-white/80 px-2 py-2">
            <p className="text-orange-700">累计赠送</p>
            <p className="font-semibold">{formatMYR(account?.data.totalBonusAmount ?? 0)}</p>
          </div>
          <div className="rounded-lg bg-white/80 px-2 py-2">
            <p className="text-orange-700">累计抵扣</p>
            <p className="font-semibold">{formatMYR(account?.data.totalSpentAmount ?? 0)}</p>
          </div>
        </div>
        <Link
          to="/feituan/wallet/topup"
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white"
        >
          充值
        </Link>
        {pendingRequests > 0 ? (
          <p className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-xs text-amber-900">
            还有 {pendingRequests} 笔充值待核实，饭团管理员确认后会自动入账。
          </p>
        ) : null}
      </section>

      <section className="mb-4 rounded-xl border border-gray-100 bg-white p-3">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">当前区间汇总（全部流水）</h2>
        <div className="grid grid-cols-3 gap-2 text-xs text-gray-700">
          <div>实充：{formatMYR(periodTotals.topupPay)}</div>
          <div>赠送：{formatMYR(periodTotals.topupBonus)}</div>
          <div>抵扣：{formatMYR(periodTotals.spent)}</div>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">充值申请</h2>
        {requests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-3 py-5 text-center text-xs text-gray-500">
            暂无充值申请。
          </p>
        ) : (
          <div className="space-y-2">
            {requests.slice(0, 8).map((row) => {
              const eff = effectiveFeituanWalletTopupStatus(row.data);
              return (
              <div key={row.id} className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">
                      实付 {formatMYR(row.data.payAmount)} · 入账 {formatMYR(row.data.creditAmount)}
                    </p>
                    <p className="mt-0.5 text-gray-500">
                      赠送 {formatMYR(row.data.bonusAmount)} · {fmtTime(row.data.createdAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 ${requestStatusClass(eff)}`}>
                    {requestStatusLabel(eff)}
                  </span>
                </div>
                {row.data.rejectReason ? (
                  <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-red-700">
                    终止说明：{row.data.rejectReason}
                  </p>
                ) : null}
                {eff === 'awaiting_payment' && row.data.lastProofRejectedReason ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-amber-900">
                    上次驳回凭证：{row.data.lastProofRejectedReason}
                  </p>
                ) : null}
                {(row.data.paymentScreenshots ?? []).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(row.data.paymentScreenshots ?? []).slice(0, 4).map((shot) => (
                      <a key={shot.url} href={shot.url} target="_blank" rel="noreferrer">
                        <img src={shot.url} alt="充值付款截图" className="h-12 w-12 rounded-md object-cover" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">钱包流水</h2>
        {ledger.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-3 py-5 text-center text-xs text-gray-500">
            暂无流水。
          </p>
        ) : (
          <div className="space-y-2">
            {ledger.slice(0, 12).map((row) => (
              <div key={row.id} className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {ledgerTypeLabel(row.data.type)}
                    </p>
                    <p className="mt-0.5 text-gray-500">{fmtTime(row.data.createdAt)}</p>
                    {row.data.orderProjectId && row.data.orderNumber ? (
                      <Link
                        to={`/feituan/projects/${encodeURIComponent(row.data.orderProjectId)}/orders/${encodeURIComponent(row.data.orderNumber)}`}
                        state={{ returnTo: '/feituan/wallet' }}
                        className="mt-1 inline-flex text-orange-600 underline-offset-2 hover:underline"
                      >
                        查看订单 #{row.data.orderNumber}
                      </Link>
                    ) : null}
                    {row.data.note ? (
                      <p className="mt-1 text-gray-500">{row.data.note}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p
                      className={
                        Number(row.data.delta) >= 0
                          ? 'font-semibold text-emerald-700'
                          : 'font-semibold text-gray-900'
                      }
                    >
                      {Number(row.data.delta) >= 0 ? '+' : ''}
                      {formatMYR(row.data.delta)}
                    </p>
                    <p className="mt-0.5 text-gray-500">
                      余额 {formatMYR(row.data.balanceAfter)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
